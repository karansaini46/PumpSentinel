import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortfolioRiskController } from '../../src/modules/risk/portfolio-risk-controller.js';
import { PortfolioService } from '../../src/modules/portfolio/portfolio.service.js';
import { PaperExecutionEngine } from '../../src/modules/execution/paper-engine.service.js';
import { PaperTradingRepository } from '../../src/modules/persistence/paper-trading.repository.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import type {
  MarketDataQuote,
  SimulatedOrderRequest,
} from '../../src/modules/execution/execution.types.js';
import {
  TradingPausedError,
  MaxPositionSizeExceededError,
  MaxConcurrentPositionsExceededError,
  MaxTotalExposureExceededError,
} from '../../src/modules/risk/portfolio-risk.types.js';

describe('PortfolioRiskController - Independent Risk Controller', () => {
  let portfolio: PortfolioService;
  let executionEngine: PaperExecutionEngine;
  let repository: PaperTradingRepository;
  let notifications: NotificationsService;
  let riskController: PortfolioRiskController;

  const MINT_A = 'MintAAAA1111111111111111111111111111111111';
  const MINT_B = 'MintBBBB2222222222222222222222222222222222';
  const MINT_C = 'MintCCCC3333333333333333333333333333333333';
  const MINT_D = 'MintDDDD4444444444444444444444444444444444';
  const MINT_E = 'MintEEEE5555555555555555555555555555555555';
  const MINT_F = 'MintFFFF6666666666666666666666666666666666';

  beforeEach(() => {
    // Fresh repository & in-memory cache
    repository = new PaperTradingRepository();
    repository.clearMemory();

    // Portfolio initialized with 10.0 SOL ($1600 USD)
    portfolio = new PortfolioService(
      {
        startingBalanceUsd: 1600.0,
        solPriceUsd: 160.0,
        defaultPositionSizeUsd: 80.0, // 0.5 SOL
        maxConcurrentPositions: 5,
        takeProfitPct: 20.0,
        stopLossPct: 10.0,
        maxHoldingTimeMs: 300000,
      },
      repository,
    );

    executionEngine = new PaperExecutionEngine({
      minPoolLiquiditySol: 15.0,
      defaultSlippageBps: 100, // 1.0%
      swapFeePct: 1.0,
      simulatedNetworkFeeSol: 0.005,
      maxAllowedPriceImpactPct: 35.0,
      maxOrderToLiquidityRatio: 0.25,
      minFillRatio: 0.8,
    });

    notifications = new NotificationsService();

    // Independent Portfolio-Risk Controller with initial experimental values
    riskController = new PortfolioRiskController(
      {
        maxPositionSizeSol: 1.0,
        maxPositionSizeUsd: 160.0,
        maxConcurrentPositions: 5,
        maxTotalExposureSol: 4.0,
        maxTotalExposurePct: 80.0,
        maxDailyLossPct: 10.0, // Initial experimental: 10% of starting daily equity
        maxDrawdownPct: 15.0, // Initial experimental: 15% drawdown
        stopLossPct: 10.0, // Initial experimental: 10%
        takeProfitPct: 20.0, // Initial experimental: 20%
        maxHoldingDurationMs: 300000, // Initial experimental: 5 minutes (300,000 ms)
        solPriceUsd: 160.0,
        pauseOnEmergencyExit: true,
        pauseOnDailyLossBreach: true,
        pauseOnDrawdownBreach: true,
      },
      portfolio,
      executionEngine,
      repository,
      notifications,
    );
  });

  // =========================================================================
  // 1. Initial Experimental Config & Limits
  // =========================================================================
  describe('Configurable Controls & Initial Experimental Values', () => {
    it('verifies initial experimental control limits', () => {
      const cfg = riskController.getConfig();
      expect(cfg.stopLossPct).toBe(10.0);
      expect(cfg.takeProfitPct).toBe(20.0);
      expect(cfg.maxHoldingDurationMs).toBe(300000); // 5 minutes
      expect(cfg.maxDailyLossPct).toBe(10.0);
      expect(cfg.maxPositionSizeSol).toBe(1.0);
      expect(cfg.maxConcurrentPositions).toBe(5);
      expect(cfg.maxTotalExposureSol).toBe(4.0);
      expect(cfg.maxDrawdownPct).toBe(15.0);
    });

    it('allows dynamic runtime reconfiguration of limits', () => {
      riskController.updateConfig({
        stopLossPct: 15.0,
        takeProfitPct: 35.0,
        maxHoldingDurationMs: 600000, // 10 minutes
        maxPositionSizeSol: 2.0,
      });

      const updated = riskController.getConfig();
      expect(updated.stopLossPct).toBe(15.0);
      expect(updated.takeProfitPct).toBe(35.0);
      expect(updated.maxHoldingDurationMs).toBe(600000);
      expect(updated.maxPositionSizeSol).toBe(2.0);
    });
  });

  // =========================================================================
  // 2. Global Trading Pause
  // =========================================================================
  describe('Global Trading Pause Controls', () => {
    it('blocks new positions when global pause is active', () => {
      riskController.pauseTrading('Market volatility anomaly detected', 'MANUAL');

      expect(riskController.isTradingPaused()).toBe(true);
      const pauseDetails = riskController.getPauseDetails();
      expect(pauseDetails.isPaused).toBe(true);
      expect(pauseDetails.reason).toBe('Market volatility anomaly detected');
      expect(pauseDetails.trigger).toBe('MANUAL');

      const buyOrder: SimulatedOrderRequest = {
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 0.5,
        reason: 'Attempted buy during pause',
      };

      const res = riskController.validatePreOrder(buyOrder);
      expect(res.allowed).toBe(false);
      expect(res.rejectionReason).toBe('TRADING_PAUSED');

      expect(() => riskController.assertPreOrderAllowed(buyOrder)).toThrow(TradingPausedError);
    });

    it('resumes trading and unblocks new positions', () => {
      riskController.pauseTrading('Maintenance window', 'MANUAL');
      expect(riskController.isTradingPaused()).toBe(true);

      riskController.resumeTrading('Maintenance complete');
      expect(riskController.isTradingPaused()).toBe(false);

      const buyOrder: SimulatedOrderRequest = {
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 0.5,
        reason: 'Buy post resume',
      };

      const res = riskController.validatePreOrder(buyOrder);
      expect(res.allowed).toBe(true);
    });
  });

  // =========================================================================
  // 3. Pre-Order Risk Controls: Sizes, Concurrency, and Exposure
  // =========================================================================
  describe('Pre-Order Position Sizing, Concurrency & Exposure Controls', () => {
    it('rejects order exceeding maximum single position size (SOL and USD)', () => {
      const oversizedSol: SimulatedOrderRequest = {
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 1.5, // Exceeds 1.0 SOL limit
        reason: 'Oversized buy',
      };

      const res = riskController.validatePreOrder(oversizedSol);
      expect(res.allowed).toBe(false);
      expect(res.rejectionReason).toBe('POSITION_SIZE_EXCEEDED');

      expect(() => riskController.assertPreOrderAllowed(oversizedSol)).toThrow(
        MaxPositionSizeExceededError,
      );
    });

    it('rejects order exceeding maximum concurrent positions (max: 5)', () => {
      // Open 5 positions
      const mints = [MINT_A, MINT_B, MINT_C, MINT_D, MINT_E];
      for (const mint of mints) {
        const fill = executionEngine.executeSimulatedOrder({
          tokenMint: mint,
          tokenSymbol: 'SYM',
          side: 'BUY',
          solAmount: 0.5,
          reason: 'Initial fill',
          currentPriceSol: 0.001,
          bypassRiskGateForTestingOnly: true,
        });
        portfolio.recordTrade(fill);
      }

      expect(portfolio.getOpenPositions()).toHaveLength(5);

      // Attempt 6th position
      const sixthOrder: SimulatedOrderRequest = {
        tokenMint: MINT_F,
        tokenSymbol: 'SYMF',
        side: 'BUY',
        solAmount: 0.5,
        reason: '6th concurrent position',
      };

      const res = riskController.validatePreOrder(sixthOrder);
      expect(res.allowed).toBe(false);
      expect(res.rejectionReason).toBe('MAX_POSITIONS_EXCEEDED');

      expect(() => riskController.assertPreOrderAllowed(sixthOrder)).toThrow(
        MaxConcurrentPositionsExceededError,
      );
    });

    it('rejects order exceeding maximum total portfolio exposure', () => {
      // Current maxTotalExposureSol is 4.0 SOL
      // Fill 3 positions of 1.0 SOL each = 3.0 SOL exposure
      for (const mint of [MINT_A, MINT_B, MINT_C]) {
        const fill = executionEngine.executeSimulatedOrder({
          tokenMint: mint,
          tokenSymbol: 'SYM',
          side: 'BUY',
          solAmount: 1.0,
          reason: 'Max fill',
          currentPriceSol: 0.001,
          bypassRiskGateForTestingOnly: true,
        });
        portfolio.recordTrade(fill);
      }

      // Next order of 1.2 SOL would push total exposure to 4.2 SOL > 4.0 SOL
      // Even if under individual position size if we set maxPositionSize to 1.5
      riskController.updateConfig({ maxPositionSizeSol: 2.0 });

      const heavyOrder: SimulatedOrderRequest = {
        tokenMint: MINT_D,
        tokenSymbol: 'SYMD',
        side: 'BUY',
        solAmount: 1.2,
        reason: 'Excess exposure buy',
      };

      const res = riskController.validatePreOrder(heavyOrder);
      expect(res.allowed).toBe(false);
      expect(res.rejectionReason).toBe('TOTAL_EXPOSURE_EXCEEDED');

      expect(() => riskController.assertPreOrderAllowed(heavyOrder)).toThrow(
        MaxTotalExposureExceededError,
      );
    });

    it('rejects duplicate position on same token mint', () => {
      const fill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 0.5,
        reason: 'First fill',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(fill);

      const dupOrder: SimulatedOrderRequest = {
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 0.5,
        reason: 'Duplicate buy attempt',
      };

      const res = riskController.validatePreOrder(dupOrder);
      expect(res.allowed).toBe(false);
      expect(res.rejectionReason).toBe('DUPLICATE_POSITION');
    });
  });

  // =========================================================================
  // 4. Exit Evaluation: TP, SL, Max Holding Duration
  // =========================================================================
  describe('Exit Trigger Evaluation', () => {
    let entryPrice: number;

    beforeEach(() => {
      const fill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 1.0,
        reason: 'Entry',
        currentPriceSol: 0.001, // Base price: 0.001 SOL
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(fill);
      entryPrice = fill.executedPriceSol;
    });

    it('triggers Take-Profit when target +20% is reached', () => {
      const quote: MarketDataQuote = {
        priceSol: entryPrice * 1.25, // +25%
        liquiditySol: 30.0,
        observedAt: Date.now(),
        source: 'quote_feed',
      };

      const evalRes = riskController.evaluatePositionExit(MINT_A, quote);
      expect(evalRes.shouldExit).toBe(true);
      expect(evalRes.triggerReason).toBe('TAKE_PROFIT_TRIGGERED');
      expect(evalRes.isTakeProfit).toBe(true);
      expect(evalRes.pnlPercent).toBeCloseTo(25.0, 1);
    });

    it('triggers Stop-Loss when threshold -10% is reached', () => {
      const quote: MarketDataQuote = {
        priceSol: entryPrice * 0.88, // -12%
        liquiditySol: 30.0,
        observedAt: Date.now(),
        source: 'quote_feed',
      };

      const evalRes = riskController.evaluatePositionExit(MINT_A, quote);
      expect(evalRes.shouldExit).toBe(true);
      expect(evalRes.triggerReason).toBe('STOP_LOSS_TRIGGERED');
      expect(evalRes.isStopLoss).toBe(true);
      expect(evalRes.pnlPercent).toBeCloseTo(-12.0, 1);
    });

    it('triggers Maximum Holding Duration exit when 5 minutes expire', () => {
      const nowMs = Date.now() + 310000;
      const quote: MarketDataQuote = {
        priceSol: entryPrice, // 0% change
        liquiditySol: 30.0,
        observedAt: nowMs, // Fresh quote observed at nowMs
        source: 'quote_feed',
      };

      const evalRes = riskController.evaluatePositionExit(MINT_A, quote, nowMs);
      expect(evalRes.shouldExit).toBe(true);
      expect(evalRes.triggerReason).toBe('MAX_HOLDING_DURATION_EXPIRED');
      expect(evalRes.isHoldingExpired).toBe(true);
      expect(evalRes.holdingDurationMs).toBeGreaterThanOrEqual(300000);
    });

    it('recommends HOLD when position is within target bounds', () => {
      const quote: MarketDataQuote = {
        priceSol: 0.00105, // +5%
        liquiditySol: 30.0,
        observedAt: Date.now(),
        source: 'quote_feed',
      };

      const evalRes = riskController.evaluatePositionExit(MINT_A, quote);
      expect(evalRes.shouldExit).toBe(false);
      expect(evalRes.triggerReason).toBe('HOLD_POSITION');
    });
  });

  // =========================================================================
  // 5. Market Crashes, Gaps, Slippage & Non-Guaranteed Stop-Loss
  // =========================================================================
  describe('Market Crashes, Price Gaps, Slippage & Non-Guaranteed Stop-Loss', () => {
    it('models price gaps: stop-loss does NOT execute at configured 10% price during flash crash', async () => {
      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 1.0,
        reason: 'Entry buy',
        marketData: {
          priceSol: 0.001,
          liquiditySol: 30.0,
          observedAt: Date.now(),
          source: 'pool',
        },
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(buyFill);

      const entryPrice = buyFill.executedPriceSol;

      // Market crashes precipitously: Price suddenly gaps down from 0.001 to 0.00065 (-35% gap!)
      const crashedQuote: MarketDataQuote = {
        priceSol: 0.00065, // Gap down of 35%
        liquiditySol: 25.0,
        observedAt: Date.now(),
        source: 'pool',
      };

      const evalRes = riskController.evaluatePositionExit(MINT_A, crashedQuote);
      expect(evalRes.shouldExit).toBe(true);
      expect(evalRes.triggerReason).toBe('STOP_LOSS_TRIGGERED');

      // Execute exit
      const exitRes = await riskController.executeExit(
        MINT_A,
        crashedQuote,
        evalRes.reasonMessage,
      );

      expect(exitRes.status).toBe('FILLED');
      const executedTrade = exitRes.trade!;

      // Invariant Check: The fill price must reflect the 35% gap PLUS adverse price impact and slippage!
      // Configured stop loss was 10% (which would be ~0.0009 SOL), but the executed price is <= 0.00065 SOL!
      expect(executedTrade.executedPriceSol).toBeLessThan(0.00065);
      expect(executedTrade.executedPriceSol).toBeLessThan(entryPrice * 0.9); // Vastly worse than -10%

      // Realized loss must reflect the full gap and costs
      const summary = portfolio.getSummary();
      expect(summary.realizedPnlSol).toBeLessThan(-0.35); // Realized loss is > 35% of 1.0 SOL
    });

    it('triggers Drawdown circuit breaker and pauses trading when portfolio crashes', () => {
      // Open position with 2.0 SOL
      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 2.0,
        reason: 'Large position',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(buyFill);

      // Price collapses by 90%: 2.0 SOL investment drops to 0.2 SOL (1.8 SOL loss on 10 SOL equity = 18% drawdown > 15% maxDrawdownPct)
      portfolio.updatePrice(MINT_A, 0.0001);

      const metrics = riskController.getEquityMetrics();
      expect(metrics.currentDrawdownPct).toBeGreaterThanOrEqual(15.0);
      expect(metrics.isDrawdownBreached).toBe(true);

      // Verify trading pause was automatically engaged
      expect(riskController.isTradingPaused()).toBe(true);
      expect(riskController.getPauseDetails().trigger).toBe('DRAWDOWN');

      // Attempting any new BUY order is strictly blocked
      const newOrder: SimulatedOrderRequest = {
        tokenMint: MINT_B,
        tokenSymbol: 'TKNB',
        side: 'BUY',
        solAmount: 0.5,
        reason: 'Buy during drawdown breach',
      };
      expect(() => riskController.assertPreOrderAllowed(newOrder)).toThrow(TradingPausedError);
    });

    it('triggers Daily Loss circuit breaker when daily simulated loss exceeds configured percentage', () => {
      // 10.0 SOL starting equity. Configured daily loss limit: 10% (1.0 SOL loss)
      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 2.0,
        reason: 'Heavy buy',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(buyFill);

      // Token price plummets to 0.0004 SOL (loss of 1.2 SOL > 1.0 SOL daily limit)
      portfolio.updatePrice(MINT_A, 0.0004);

      const metrics = riskController.getEquityMetrics();
      expect(metrics.dailyLossPct).toBeGreaterThanOrEqual(10.0);
      expect(metrics.isDailyLossBreached).toBe(true);

      expect(riskController.isTradingPaused()).toBe(true);
      expect(riskController.getPauseDetails().trigger).toBe('DAILY_LOSS');
    });
  });

  // =========================================================================
  // 6. Insufficient Liquidity & EXIT_PENDING Handling
  // =========================================================================
  describe('Failed Exits & EXIT_PENDING State Transitions', () => {
    it('transitions position to EXIT_PENDING and alerts operator when pool liquidity is drained', async () => {
      const notifySpy = vi.spyOn(notifications, 'notify');

      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'RUGGED',
        side: 'BUY',
        solAmount: 1.0,
        reason: 'Pre-rug buy',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(buyFill);

      // Rugpull scenario: Pool liquidity is drained from 30 SOL to 0.5 SOL (below 15.0 SOL min pool liquidity)
      const drainedQuote: MarketDataQuote = {
        priceSol: 0.0001,
        liquiditySol: 0.5, // Drained pool!
        observedAt: Date.now(),
        source: 'bonding_curve',
      };

      const exitRes = await riskController.executeExit(
        MINT_A,
        drainedQuote,
        'EMERGENCY: Liquidity drained',
        { isEmergency: true },
      );

      // Execution cannot be simulated realistically: must transition to EXIT_PENDING
      expect(exitRes.status).toBe('EXIT_PENDING');
      expect(exitRes.exitPending).toBeDefined();
      expect(exitRes.exitPending?.tokenMint).toBe(MINT_A);
      expect(exitRes.exitPending?.failureReason).toContain('Pool liquidity exhausted');

      // Verify position status updated in portfolio and repository
      const pos = portfolio.getPosition(MINT_A);
      expect(pos?.status).toBe('EXIT_PENDING');
      expect(riskController.isExitPending(MINT_A)).toBe(true);

      // Verify operator was alerted
      expect(notifySpy).toHaveBeenCalledWith(
        'PORTFOLIO_RISK',
        expect.stringContaining('EMERGENCY EXIT FAILED: Position marked EXIT_PENDING'),
        expect.any(String),
        'HIGH',
        expect.any(Object),
      );
    });

    it('emergencyExitAll marks un-exitable positions as EXIT_PENDING and pauses trading', async () => {
      // Open two positions
      for (const mint of [MINT_A, MINT_B]) {
        const fill = executionEngine.executeSimulatedOrder({
          tokenMint: mint,
          tokenSymbol: mint === MINT_A ? 'HEALTHY' : 'UNLIQUID',
          side: 'BUY',
          solAmount: 0.5,
          reason: 'Open pos',
          currentPriceSol: 0.001,
          bypassRiskGateForTestingOnly: true,
        });
        portfolio.recordTrade(fill);
      }

      const quotes = new Map<string, MarketDataQuote>();
      // Healthy position with good liquidity
      quotes.set(MINT_A, {
        priceSol: 0.001,
        liquiditySol: 30.0,
        observedAt: Date.now(),
        source: 'pool',
      });
      // Unliquid position with drained pool
      quotes.set(MINT_B, {
        priceSol: 0.0005,
        liquiditySol: 2.0, // Insufficient liquidity!
        observedAt: Date.now(),
        source: 'pool',
      });

      const summary = await riskController.emergencyExitAll('Catastrophic market collapse', quotes);

      expect(summary.totalEvaluated).toBe(2);
      expect(summary.filledExits).toBe(1);
      expect(summary.pendingExits).toBe(1);
      expect(summary.pendingPositions[0]?.tokenMint).toBe(MINT_B);

      // Global trading pause must be engaged
      expect(riskController.isTradingPaused()).toBe(true);
      expect(riskController.getPauseDetails().trigger).toBe('EMERGENCY_EXIT');
    });
  });

  // =========================================================================
  // 7. Concurrent Exit Signals & Race Conditions
  // =========================================================================
  describe('Concurrent Exit Signals & Race Condition Protection', () => {
    it('prevents double-sell race conditions when concurrent exits target the same position', async () => {
      const fill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 1.0,
        reason: 'Buy',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(fill);

      const quote: MarketDataQuote = {
        priceSol: 0.0008, // -20% stop loss
        liquiditySol: 30.0,
        observedAt: Date.now(),
        source: 'pool',
      };

      // Fire 3 simultaneous concurrent exit requests for the exact same position
      const [res1, res2, res3] = await Promise.all([
        riskController.executeExit(MINT_A, quote, 'Stop-Loss Signal 1'),
        riskController.executeExit(MINT_A, quote, 'Emergency Close Signal 2'),
        riskController.executeExit(MINT_A, quote, 'Stop-Loss Signal 3'),
      ]);

      const filled = [res1, res2, res3].filter((r) => r.status === 'FILLED');
      const skipped = [res1, res2, res3].filter((r) => r.status === 'SKIPPED_CONCURRENT');

      // Exactly ONE exit must execute; the concurrent calls must be safely deduped
      expect(filled).toHaveLength(1);
      expect(skipped).toHaveLength(2);

      // Verify position was closed exactly once
      expect(portfolio.getOpenPositions()).toHaveLength(0);
      expect(portfolio.getSummary().totalTrades).toBe(2); // 1 BUY + 1 SELL
    });

    it('handles concurrent exits across multiple different positions cleanly', async () => {
      const mints = [MINT_A, MINT_B, MINT_C];
      for (const mint of mints) {
        const fill = executionEngine.executeSimulatedOrder({
          tokenMint: mint,
          tokenSymbol: 'SYM',
          side: 'BUY',
          solAmount: 0.5,
          reason: 'Buy',
          currentPriceSol: 0.001,
          bypassRiskGateForTestingOnly: true,
        });
        portfolio.recordTrade(fill);
      }

      expect(portfolio.getOpenPositions()).toHaveLength(3);

      const quote: MarketDataQuote = {
        priceSol: 0.0013, // +30% TP
        liquiditySol: 30.0,
        observedAt: Date.now(),
        source: 'pool',
      };

      // Exit all 3 distinct positions simultaneously in parallel
      const exitResults = await Promise.all(
        mints.map((mint) => riskController.executeExit(mint, quote, 'Take-Profit All')),
      );

      expect(exitResults.every((r) => r.status === 'FILLED')).toBe(true);
      expect(portfolio.getOpenPositions()).toHaveLength(0);
      expect(portfolio.getSummary().winCount).toBe(3);
    });
  });

  // =========================================================================
  // 8. Reconciliation: Inconsistency Detection & State Repair
  // =========================================================================
  describe('Multi-Dimensional Reconciliation Process', () => {
    it('detects and repairs cash balance discrepancies between memory, DB, and ledger', async () => {
      // Initial state: 10.0 SOL
      // Perform 1 BUY of 1.0 SOL + 0.005 fee => remaining cash should be 8.995 SOL
      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 1.0,
        reason: 'Buy',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(buyFill);

      // Intentionally corrupt DB account cash balance (e.g. out-of-sync DB)
      await repository.saveAccount({
        simulatedSolBalance: 12.5, // Corrupted balance!
        initialSolBalance: 10.0,
        totalRealizedPnlSol: 0.0,
        winCount: 0,
        lossCount: 0,
      });

      const audit = await riskController.reconcile();

      expect(audit.isAuditedAndReconciled).toBe(true);
      expect(audit.status).toBe('DISCREPANCIES_RESOLVED');
      expect(audit.inconsistenciesDetected.some((i) => i.type === 'CASH_DISCREPANCY')).toBe(true);

      // Verify cash balance was repaired to ground-truth replayed ledger (8.995 SOL)
      expect(audit.cashAudit.reconciledBalanceSol).toBeCloseTo(8.995, 3);
      expect(portfolio.getSolBalance()).toBeCloseTo(8.995, 3);
    });

    it('detects ghost open positions in DB when all tokens were sold in trade ledger', async () => {
      // Create position in DB marked OPEN
      const pos = await repository.savePosition({
        id: 'pos_ghost',
        tokenMint: MINT_A,
        tokenSymbol: 'GHOST',
        amountTokens: 1000,
        entryPriceSol: 0.001,
        currentPriceSol: 0.001,
        solInvested: 1.0,
        status: 'OPEN',
      });

      // Record BUY of 1000 tokens
      await repository.recordTrade({
        id: 'trade_buy_1',
        positionId: pos.id,
        tokenMint: MINT_A,
        side: 'BUY',
        amountTokens: 1000,
        priceSol: 0.001,
        totalSol: 1.0,
        simulatedFeeSol: 0.005,
        slippageBps: 100,
        reason: 'Buy',
      });

      // Record SELL of all 1000 tokens (position should be CLOSED, but DB still says OPEN!)
      await repository.recordTrade({
        id: 'trade_sell_1',
        positionId: pos.id,
        tokenMint: MINT_A,
        side: 'SELL',
        amountTokens: 1000,
        priceSol: 0.0015,
        totalSol: 1.5,
        simulatedFeeSol: 0.005,
        slippageBps: 100,
        reason: 'Sell',
      });

      const audit = await riskController.reconcile();

      expect(audit.inconsistenciesDetected.some((i) => i.type === 'GHOST_OPEN_POSITION')).toBe(
        true,
      );
      expect(audit.repairedIssues).toContainEqual(expect.stringContaining('Closed ghost position'));

      // Check DB position is now marked CLOSED
      const updatedPositions = await repository.getAllPositions();
      const updatedGhost = updatedPositions.find((p) => p.tokenMint === MINT_A);
      expect(updatedGhost?.status).toBe('CLOSED');
    });

    it('detects orphaned trades without position IDs', async () => {
      await repository.recordTrade({
        id: 'orphan_trade_1',
        positionId: undefined, // Orphaned!
        tokenMint: MINT_B,
        side: 'BUY',
        amountTokens: 500,
        priceSol: 0.001,
        totalSol: 0.5,
        simulatedFeeSol: 0.005,
        slippageBps: 100,
        reason: 'Orphaned buy',
      });

      const audit = await riskController.reconcile();
      expect(audit.inconsistenciesDetected.some((i) => i.type === 'ORPHANED_TRADE')).toBe(true);
      expect(audit.positionsAudit.orphanedTradesCount).toBe(1);
    });
  });

  // =========================================================================
  // 9. Application Restarts & State Recovery
  // =========================================================================
  describe('Application Restarts & Full State Recovery', () => {
    it('restores open positions, EXIT_PENDING status, and cash balance accurately across app restarts', async () => {
      // 1. Session 1: Buy 2 tokens, one healthy, one EXIT_PENDING
      const fillA = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_A,
        tokenSymbol: 'TKNA',
        side: 'BUY',
        solAmount: 1.0,
        reason: 'Buy A',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(fillA);

      const fillB = executionEngine.executeSimulatedOrder({
        tokenMint: MINT_B,
        tokenSymbol: 'TKNB',
        side: 'BUY',
        solAmount: 0.5,
        reason: 'Buy B',
        currentPriceSol: 0.001,
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(fillB);

      // Position B attempted exit with drained liquidity => transitioned to EXIT_PENDING
      await riskController.executeExit(
        MINT_B,
        { priceSol: 0.0001, liquiditySol: 1.0, observedAt: Date.now(), source: 'pool' },
        'Emergency close',
        { isEmergency: true },
      );

      expect(portfolio.getPosition(MINT_B)?.status).toBe('EXIT_PENDING');

      // 2. Simulate Application Restart: Fresh controller and portfolio instances connected to same repository
      const freshPortfolio = new PortfolioService(10.0, repository);
      const freshRiskController = new PortfolioRiskController(
        {},
        freshPortfolio,
        executionEngine,
        repository,
        notifications,
      );

      // Initialize fresh controller
      await freshRiskController.initialize();

      // Verify Session 2 restored state:
      // Cash balance restored to exactly: 10.0 - (1.0 + 0.005) - (0.5 + 0.005) = 8.490 SOL
      expect(freshPortfolio.getSolBalance()).toBeCloseTo(8.49, 2);

      // Open positions restored
      const restoredOpen = freshPortfolio.getOpenPositions();
      expect(restoredOpen).toHaveLength(1);
      expect(restoredOpen[0]?.tokenMint).toBe(MINT_A);

      // EXIT_PENDING position restored into active tracking
      expect(freshRiskController.isExitPending(MINT_B)).toBe(true);
      const exitPendingList = freshRiskController.getExitPendingPositions();
      expect(exitPendingList).toHaveLength(1);
      expect(exitPendingList[0]?.tokenMint).toBe(MINT_B);
    });
  });
});
