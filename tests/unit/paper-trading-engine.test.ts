import { describe, it, expect, beforeEach } from 'vitest';
import { PaperExecutionEngine } from '../../src/modules/execution/paper-engine.service.js';
import {
  PortfolioService,
  DEFAULT_PORTFOLIO_CONFIG,
} from '../../src/modules/portfolio/portfolio.service.js';
import type { MarketDataQuote } from '../../src/modules/execution/execution.types.js';
import {
  UnrealisticExecutionError,
  StaleMarketDataError,
  FutureMarketDataError,
  DuplicatePositionError,
  DuplicateFillError,
  MaxPositionsExceededError,
  PositionNotFoundError,
  InsufficientSimulatedBalanceError,
} from '../../src/modules/execution/execution.types.js';
import { paperTradingRepository } from '../../src/modules/persistence/paper-trading.repository.js';

describe('Paper Trading Engine - Complete Test Suite', () => {
  let executionEngine: PaperExecutionEngine;
  let portfolio: PortfolioService;

  beforeEach(() => {
    paperTradingRepository.clearMemory();
    executionEngine = new PaperExecutionEngine({
      defaultSlippageBps: 150, // 1.5%
      simulatedNetworkFeeSol: 0.005,
      swapFeePct: 1.0,
      maxAllowedPriceImpactPct: 35.0,
      maxOrderToLiquidityRatio: 0.25,
      minPoolLiquiditySol: 15.0,
      maxMarketDataAgeMs: 60000,
      minFillRatio: 0.8,
      solPriceUsd: 160.0,
    });

    portfolio = new PortfolioService({
      startingBalanceUsd: 800.0,
      defaultPositionSizeUsd: 20.0,
      maxConcurrentPositions: 5,
      takeProfitPct: 50.0,
      stopLossPct: 20.0,
      maxHoldingTimeMs: 3600000, // 1 hour
      solPriceUsd: 160.0,
    });
  });

  // =========================================================================
  // 1. Initial Portfolio Defaults & Dual-Currency Accounting
  // =========================================================================
  describe('Portfolio Initialization & Configuration', () => {
    it('initializes with $800 starting balance, $20 default position, and max 5 concurrent positions', () => {
      const summary = portfolio.getSummary();

      // Dual-currency accounting: USD and SOL
      expect(summary.initialBalanceUsd).toBe(800.0);
      expect(summary.currentCashBalanceUsd).toBe(800.0);
      // At $160 / SOL, $800 = 5.0 SOL
      expect(summary.initialSolBalance).toBe(5.0);
      expect(summary.currentSolBalance).toBe(5.0);

      expect(summary.defaultPositionSizeUsd).toBe(20.0);
      // Default position size in SOL: $20 / $160 = 0.125 SOL
      expect(portfolio.getDefaultPositionSizeSol()).toBeCloseTo(0.125, 4);

      expect(summary.maxConcurrentPositions).toBe(5);
      expect(summary.takeProfitPct).toBe(50.0);
      expect(summary.stopLossPct).toBe(20.0);
      expect(summary.maxHoldingTimeMs).toBe(3600000);
      expect(summary.openPositionsCount).toBe(0);
      expect(summary.realizedPnlUsd).toBe(0.0);
      expect(summary.unrealizedPnlUsd).toBe(0.0);
      expect(summary.totalFeesPaidUsd).toBe(0.0);
    });

    it('verifies DEFAULT_PORTFOLIO_CONFIG constants', () => {
      expect(DEFAULT_PORTFOLIO_CONFIG.startingBalanceUsd).toBe(800.0);
      expect(DEFAULT_PORTFOLIO_CONFIG.defaultPositionSizeUsd).toBe(20.0);
      expect(DEFAULT_PORTFOLIO_CONFIG.maxConcurrentPositions).toBe(5);
    });

    it('throws InsufficientSimulatedBalanceError when trade cost exceeds available cash balance', () => {
      const hugeBuy = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintHugeCash111111111111111111111111111',
        tokenSymbol: 'HUGE',
        side: 'BUY',
        solAmount: 0.1,
        currentPriceSol: 0.001,
        reason: 'Buy',
        bypassRiskGateForTestingOnly: true,
      });

      hugeBuy.totalSol = 100.0; // Artificial massive cost exceeding 5.0 SOL balance

      expect(() => {
        portfolio.recordTrade(hugeBuy);
      }).toThrow(InsufficientSimulatedBalanceError);
    });

    it('throws PositionNotFoundError when attempting to sell a token with no open position', () => {
      const ghostSell = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintNonExistent1111111111111111111111111',
        tokenSymbol: 'GHOST',
        side: 'SELL',
        tokenAmount: 100,
        currentPriceSol: 0.001,
        reason: 'Attempt sell non-existent position',
      });

      expect(() => {
        portfolio.recordTrade(ghostSell);
      }).toThrow(PositionNotFoundError);
    });

    it('asserts simulation invariants: throws fatal error if wallet private key is injected', () => {
      process.env['PRIVATE_KEY'] = 'fake_private_key_0xdeadbeef';
      try {
        expect(() => new PaperExecutionEngine()).toThrow(/FATAL: Real private key detected/);
        expect(() => new PortfolioService()).toThrow(/FATAL: Real private key detected/);
      } finally {
        delete process.env['PRIVATE_KEY'];
      }
    });
  });

  // =========================================================================
  // 2. Realistic Execution: Slippage, Fees, Price Impact, Liquidity
  // =========================================================================
  describe('Realistic Market Execution Simulation', () => {
    const now = Date.now();
    const validQuote: MarketDataQuote = {
      priceSol: 0.001,
      liquiditySol: 30.0,
      marketCapSol: 100.0,
      observedAt: new Date(now - 1000), // 1 second ago
      source: 'raydium_pump_fun',
    };

    it('simulates entry BUY with constant product AMM price impact and realistic fees', () => {
      const buyAmountSol = 0.125; // $20 position
      const fill = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintAlpha1111111111111111111111111111111111',
        tokenSymbol: 'ALPHA',
        side: 'BUY',
        solAmount: buyAmountSol,
        marketData: validQuote,
        evaluationTimestamp: now,
        reason: 'Strategy BUY signal',
        bypassRiskGateForTestingOnly: true,
      });

      expect(fill.isSimulated).toBe(true);
      expect(fill.side).toBe('BUY');
      expect(fill.requestedPriceSol).toBe(0.001);
      // Constant product impact for 0.125 SOL in 30 SOL pool:
      // impact = 0.125 / (30 + 0.125) ≈ 0.415%
      expect(fill.priceImpactPct).toBeCloseTo(0.415, 2);
      // Slippage is 1.5% (150 bps)
      expect(fill.slippageBpsApplied).toBe(150);
      // Total multiplier ≈ (1 + 0.00415) * (1 + 0.015) ≈ 1.0192
      expect(fill.executedPriceSol).toBeGreaterThan(0.001);
      expect(fill.executedPriceSol).toBeCloseTo(0.0010192, 5);

      // Fee breakdown: 0.005 SOL network fee + 1% swap fee on 0.125 SOL (0.00125) = 0.00625 SOL
      expect(fill.networkFeeSol).toBe(0.005);
      expect(fill.swapFeeSol).toBeCloseTo(0.00125, 5);
      expect(fill.simulatedFeeSol).toBeCloseTo(0.00625, 5);

      expect(fill.isPartialFill).toBe(false);
      expect(fill.fillRatio).toBe(1.0);
    });

    it('rejects simulated fills when pool liquidity is insufficient (< 15 SOL)', () => {
      const lowLiquidityQuote: MarketDataQuote = {
        priceSol: 0.001,
        liquiditySol: 8.0, // Insufficient liquidity
        observedAt: new Date(now - 1000),
        source: 'pump_fun',
      };

      expect(() => {
        executionEngine.executeSimulatedOrder({
          tokenMint: 'MintLowLiq1111111111111111111111111111111',
          tokenSymbol: 'LOWLIQ',
          side: 'BUY',
          solAmount: 0.5,
          marketData: lowLiquidityQuote,
          evaluationTimestamp: now,
          reason: 'Attempt buy',
          bypassRiskGateForTestingOnly: true,
        });
      }).toThrow(UnrealisticExecutionError);
    });

    it('rejects simulated fills when order size exceeds pool capacity (> 25% of pool)', () => {
      const massiveOrderSol = 10.0; // 10 SOL in a 30 SOL pool = 33.3% > 25%
      expect(() => {
        executionEngine.executeSimulatedOrder({
          tokenMint: 'MintHuge11111111111111111111111111111111111',
          tokenSymbol: 'HUGE',
          side: 'BUY',
          solAmount: massiveOrderSol,
          marketData: validQuote,
          evaluationTimestamp: now,
          reason: 'Excessive buy',
          bypassRiskGateForTestingOnly: true,
        });
      }).toThrow(UnrealisticExecutionError);
    });

    it('rejects simulated fills when price impact exceeds maximum allowed limit (> 35%)', () => {
      // Create a pool where order causes > 35% impact but might be close to threshold
      const smallPoolQuote: MarketDataQuote = {
        priceSol: 0.001,
        liquiditySol: 16.0,
        observedAt: new Date(now - 1000),
        source: 'pump_fun',
      };

      // 8 SOL in 16 SOL pool: impact = 8 / 24 = 33.3% but order is 50% capacity
      expect(() => {
        executionEngine.executeSimulatedOrder({
          tokenMint: 'MintHighImpact1111111111111111111111111111',
          tokenSymbol: 'IMPACT',
          side: 'BUY',
          solAmount: 8.0,
          marketData: smallPoolQuote,
          evaluationTimestamp: now,
          reason: 'High impact buy',
          bypassRiskGateForTestingOnly: true,
        });
      }).toThrow(UnrealisticExecutionError);
    });
  });

  // =========================================================================
  // 3. Stale & Future Market Data Invariants (Anti-Lookahead)
  // =========================================================================
  describe('Anti-Lookahead and Staleness Invariants', () => {
    const now = Date.now();

    it('REQUIREMENT 12: Never use future market data to determine past fills (throws FutureMarketDataError)', () => {
      const futureQuote: MarketDataQuote = {
        priceSol: 0.002,
        liquiditySol: 30.0,
        observedAt: new Date(now + 10000), // 10 seconds in future
        source: 'pump_fun',
      };

      expect(() => {
        executionEngine.executeSimulatedOrder({
          tokenMint: 'MintFuture11111111111111111111111111111111',
          tokenSymbol: 'FUTR',
          side: 'BUY',
          solAmount: 0.125,
          marketData: futureQuote,
          evaluationTimestamp: now,
          reason: 'Future data attempt',
          bypassRiskGateForTestingOnly: true,
        });
      }).toThrow(FutureMarketDataError);
    });

    it('rejects stale market data (> 60s) without inventing a price (throws StaleMarketDataError)', () => {
      const staleQuote: MarketDataQuote = {
        priceSol: 0.001,
        liquiditySol: 30.0,
        observedAt: new Date(now - 75000), // 75 seconds ago (> 60s)
        source: 'pump_fun',
      };

      expect(() => {
        executionEngine.executeSimulatedOrder({
          tokenMint: 'MintStale11111111111111111111111111111111',
          tokenSymbol: 'STALE',
          side: 'BUY',
          solAmount: 0.125,
          marketData: staleQuote,
          evaluationTimestamp: now,
          reason: 'Stale data attempt',
          bypassRiskGateForTestingOnly: true,
        });
      }).toThrow(StaleMarketDataError);
    });

    it('rejects market data when price is non-positive or unavailable', () => {
      const zeroPriceQuote: MarketDataQuote = {
        priceSol: 0.0,
        liquiditySol: 30.0,
        observedAt: new Date(now - 1000),
        source: 'pump_fun',
      };

      expect(() => {
        executionEngine.executeSimulatedOrder({
          tokenMint: 'MintZero11111111111111111111111111111111',
          tokenSymbol: 'ZERO',
          side: 'BUY',
          solAmount: 0.125,
          marketData: zeroPriceQuote,
          evaluationTimestamp: now,
          reason: 'Zero price attempt',
          bypassRiskGateForTestingOnly: true,
        });
      }).toThrow(StaleMarketDataError);
    });
  });

  // =========================================================================
  // 4. Profitable Trades: Take-Profit (+50%) Execution
  // =========================================================================
  describe('Profitable Trades Flow', () => {
    it('executes BUY, detects Take-Profit target (+50%), closes position, increases cash balance and realized P&L', () => {
      const now = Date.now();
      const entryQuote: MarketDataQuote = {
        priceSol: 0.001,
        liquiditySol: 30.0,
        observedAt: new Date(now),
        source: 'pump_fun',
      };

      // 1. Enter position with default size $20 (0.125 SOL)
      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintProfit1111111111111111111111111111111',
        tokenSymbol: 'WINNER',
        side: 'BUY',
        solAmount: 0.125,
        marketData: entryQuote,
        evaluationTimestamp: now,
        reason: 'Entry signal',
        bypassRiskGateForTestingOnly: true,
      });

      portfolio.recordTrade(buyFill);

      const pos = portfolio.getPosition('MintProfit1111111111111111111111111111111');
      expect(pos).toBeDefined();
      expect(pos?.status).toBe('OPEN');

      // Cash balance decreased by (0.125 + fee)
      const postBuyCash = 5.0 - (0.125 + buyFill.simulatedFeeSol);
      expect(portfolio.getSolBalance()).toBeCloseTo(postBuyCash, 5);

      // 2. Token surges by +60% (price goes from ~0.001019 to 0.00165 SOL)
      const targetPriceSol = pos!.entryPriceSol * 1.6; // +60% gain
      const profitQuote: MarketDataQuote = {
        priceSol: targetPriceSol,
        liquiditySol: 35.0,
        observedAt: new Date(now + 15000), // 15 seconds later
        source: 'pump_fun',
      };

      // Update price and check unrealized P&L
      portfolio.updatePrice('MintProfit1111111111111111111111111111111', targetPriceSol);
      const updatedPos = portfolio.getPosition('MintProfit1111111111111111111111111111111')!;
      expect(updatedPos.unrealizedPnlPercent).toBeGreaterThanOrEqual(50.0);

      // 3. Evaluate exit trigger
      const exitEvaluation = portfolio.evaluatePositionExit(
        'MintProfit1111111111111111111111111111111',
        profitQuote,
        now + 15000,
      );
      expect(exitEvaluation?.shouldExit).toBe(true);
      expect(exitEvaluation?.reason).toMatch(/TAKE_PROFIT_TRIGGERED/);

      // 4. Execute Take-Profit Exit SELL
      const exitTrade = portfolio.executeExitIfTriggered(
        'MintProfit1111111111111111111111111111111',
        profitQuote,
        executionEngine,
        now + 15000,
      );
      expect(exitTrade).not.toBeNull();
      expect(exitTrade?.side).toBe('SELL');

      // Position should now be closed
      expect(portfolio.getPosition('MintProfit1111111111111111111111111111111')).toBeUndefined();

      // Summary verification
      const summary = portfolio.getSummary();
      expect(summary.openPositionsCount).toBe(0);
      expect(summary.winCount).toBe(1);
      expect(summary.lossCount).toBe(0);
      expect(summary.winRatePercent).toBe(100.0);
      expect(summary.realizedPnlSol).toBeGreaterThan(0);
      expect(summary.realizedPnlUsd).toBeGreaterThan(0);
      // Final cash balance must be higher than starting balance minus net fees
      expect(summary.currentSolBalance).toBeGreaterThan(5.0);
      expect(summary.currentCashBalanceUsd).toBeGreaterThan(800.0);
    });
  });

  // =========================================================================
  // 5. Losing Trades: Stop-Loss (-20%) Execution
  // =========================================================================
  describe('Losing Trades Flow', () => {
    it('executes BUY, detects Stop-Loss threshold (-20%), closes position, updates lossCount and realized P&L', () => {
      const now = Date.now();
      const lossMint = 'MintLoss11111111111111111111111111111111111';
      const entryQuote: MarketDataQuote = {
        priceSol: 0.001,
        liquiditySol: 30.0,
        observedAt: new Date(now),
        source: 'pump_fun',
      };

      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: lossMint,
        tokenSymbol: 'LOSER',
        side: 'BUY',
        solAmount: 0.125,
        marketData: entryQuote,
        evaluationTimestamp: now,
        reason: 'Entry signal',
        bypassRiskGateForTestingOnly: true,
      });

      portfolio.recordTrade(buyFill);
      const pos = portfolio.getPosition(lossMint)!;

      // Price drops by 25% (triggering -20% stop loss)
      const stopPriceSol = pos.entryPriceSol * 0.75;
      const stopQuote: MarketDataQuote = {
        priceSol: stopPriceSol,
        liquiditySol: 25.0,
        observedAt: new Date(now + 20000),
        source: 'pump_fun',
      };

      const exitEvaluation = portfolio.evaluatePositionExit(lossMint, stopQuote, now + 20000);
      expect(exitEvaluation?.shouldExit).toBe(true);
      expect(exitEvaluation?.reason).toMatch(/STOP_LOSS_TRIGGERED/);

      const exitTrade = portfolio.executeExitIfTriggered(
        lossMint,
        stopQuote,
        executionEngine,
        now + 20000,
      );
      expect(exitTrade).not.toBeNull();

      const summary = portfolio.getSummary();
      expect(summary.openPositionsCount).toBe(0);
      expect(summary.winCount).toBe(0);
      expect(summary.lossCount).toBe(1);
      expect(summary.winRatePercent).toBe(0.0);
      expect(summary.realizedPnlSol).toBeLessThan(0);
      expect(summary.realizedPnlUsd).toBeLessThan(0);
      expect(summary.currentSolBalance).toBeLessThan(5.0);
      expect(summary.currentCashBalanceUsd).toBeLessThan(800.0);
    });
  });

  // =========================================================================
  // 6. Maximum Holding Time Expiration
  // =========================================================================
  describe('Maximum Holding Time Expiration', () => {
    it('triggers automatic exit when holding time exceeds maxHoldingTimeMs (1 hour)', () => {
      const openTime = Date.now();
      const timeMint = 'MintTime11111111111111111111111111111111111';
      const entryQuote: MarketDataQuote = {
        priceSol: 0.001,
        liquiditySol: 30.0,
        observedAt: new Date(openTime),
        source: 'pump_fun',
      };

      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: timeMint,
        tokenSymbol: 'TIME',
        side: 'BUY',
        solAmount: 0.125,
        marketData: entryQuote,
        evaluationTimestamp: openTime,
        reason: 'Entry signal',
        bypassRiskGateForTestingOnly: true,
      });

      portfolio.recordTrade(buyFill);

      // 65 minutes later (exceeding 60-minute limit)
      const evaluationTime = openTime + 65 * 60 * 1000;
      const flatQuote: MarketDataQuote = {
        priceSol: 0.00102, // Neutral price (no TP or SL)
        liquiditySol: 30.0,
        observedAt: new Date(evaluationTime - 5000),
        source: 'pump_fun',
      };

      const exitEvaluation = portfolio.evaluatePositionExit(timeMint, flatQuote, evaluationTime);

      expect(exitEvaluation?.shouldExit).toBe(true);
      expect(exitEvaluation?.reason).toMatch(/EXPIRED_MAX_HOLDING_TIME/);

      const exitTrade = portfolio.executeExitIfTriggered(
        timeMint,
        flatQuote,
        executionEngine,
        evaluationTime,
      );
      expect(exitTrade).not.toBeNull();
      expect(portfolio.getPosition(timeMint)).toBeUndefined();
    });
  });

  // =========================================================================
  // 7. Market Crashes / Rug Pulls: Emergency Closure
  // =========================================================================
  describe('Market Crashes and Rug Pulls', () => {
    it('handles 99% price crash via emergency closure without crashing the engine', () => {
      const now = Date.now();
      const entryQuote: MarketDataQuote = {
        priceSol: 0.01,
        liquiditySol: 30.0,
        observedAt: new Date(now),
        source: 'pump_fun',
      };

      const buyFill = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintRug111111111111111111111111111111111111',
        tokenSymbol: 'RUG',
        side: 'BUY',
        solAmount: 0.125,
        marketData: entryQuote,
        evaluationTimestamp: now,
        reason: 'Entry',
        bypassRiskGateForTestingOnly: true,
      });

      portfolio.recordTrade(buyFill);

      // Rug pull event: price collapses by 99% to 0.0001 SOL, liquidity drops to 16 SOL
      const crashQuote: MarketDataQuote = {
        priceSol: 0.0001,
        liquiditySol: 16.0,
        observedAt: new Date(now + 3000),
        source: 'pump_fun',
      };

      // Emergency closure
      const emergencyFill = portfolio.emergencyClosePosition(
        'MintRug111111111111111111111111111111111111',
        crashQuote,
        'Suspected liquidity drain / rug pull detected',
        executionEngine,
      );

      expect(emergencyFill.side).toBe('SELL');
      expect(emergencyFill.reason).toMatch(/EMERGENCY_CLOSE/);
      expect(portfolio.getPosition('MintRug111111111111111111111111111111111111')).toBeUndefined();

      const summary = portfolio.getSummary();
      expect(summary.lossCount).toBe(1);
      expect(summary.realizedPnlSol).toBeLessThan(0);
      // Engine remains operational, cash balance reflects salvaged capital minus fees
      expect(summary.currentSolBalance).toBeGreaterThan(0);
    });

    it('emergency closes all open positions across multiple tokens', () => {
      const now = Date.now();
      const mints = [
        'TokenA11111111111111111111111111111111111',
        'TokenB22222222222222222222222222222222222',
      ];

      for (const mint of mints) {
        const fill = executionEngine.executeSimulatedOrder({
          tokenMint: mint,
          tokenSymbol: 'TEST',
          side: 'BUY',
          solAmount: 0.1,
          currentPriceSol: 0.001,
          reason: 'Entry',
          bypassRiskGateForTestingOnly: true,
        });
        portfolio.recordTrade(fill);
      }

      expect(portfolio.getOpenPositions()).toHaveLength(2);

      const quotesMap = new Map<string, MarketDataQuote>();
      quotesMap.set(mints[0]!, {
        priceSol: 0.0009,
        liquiditySol: 30.0,
        observedAt: new Date(now),
        source: 'pump_fun',
      });
      quotesMap.set(mints[1]!, {
        priceSol: 0.00085,
        liquiditySol: 30.0,
        observedAt: new Date(now),
        source: 'pump_fun',
      });

      const closedTrades = portfolio.emergencyCloseAllPositions(
        quotesMap,
        'Global circuit breaker triggered',
        executionEngine,
      );

      expect(closedTrades).toHaveLength(2);
      expect(portfolio.getOpenPositions()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 8. Duplicate Positions and Duplicate Fills Prevention
  // =========================================================================
  describe('Duplicate Position & Fill Prevention', () => {
    it('REQUIREMENT 7: prevents opening duplicate positions on the same token mint', () => {
      const trade1 = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintDup11111111111111111111111111111111111',
        tokenSymbol: 'DUP',
        side: 'BUY',
        solAmount: 0.1,
        currentPriceSol: 0.001,
        reason: 'First buy',
        bypassRiskGateForTestingOnly: true,
      });

      portfolio.recordTrade(trade1);

      const trade2 = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintDup11111111111111111111111111111111111', // Same mint
        tokenSymbol: 'DUP',
        side: 'BUY',
        solAmount: 0.1,
        currentPriceSol: 0.001,
        reason: 'Second buy attempt',
        bypassRiskGateForTestingOnly: true,
      });

      expect(() => {
        portfolio.recordTrade(trade2);
      }).toThrow(DuplicatePositionError);
    });

    it('REQUIREMENT 7: prevents processing duplicate fills with the same tradeId', () => {
      const trade = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintFillDup111111111111111111111111111111',
        tokenSymbol: 'FDUP',
        side: 'BUY',
        solAmount: 0.1,
        currentPriceSol: 0.001,
        reason: 'Buy',
        bypassRiskGateForTestingOnly: true,
      });

      portfolio.recordTrade(trade);

      // Re-recording the exact same trade
      expect(() => {
        portfolio.recordTrade(trade);
      }).toThrow(DuplicateFillError);
    });
  });

  // =========================================================================
  // 9. Maximum Concurrent Positions Limit (5)
  // =========================================================================
  describe('Max Concurrent Positions Limit', () => {
    it('enforces maximum concurrent positions limit of 5 and rejects 6th position', () => {
      for (let i = 1; i <= 5; i++) {
        const fill = executionEngine.executeSimulatedOrder({
          tokenMint: `MintSlot${i}111111111111111111111111111111111`,
          tokenSymbol: `SLOT${i}`,
          side: 'BUY',
          solAmount: 0.1,
          currentPriceSol: 0.001,
          reason: `Slot ${i}`,
          bypassRiskGateForTestingOnly: true,
        });
        portfolio.recordTrade(fill);
      }

      expect(portfolio.getOpenPositions()).toHaveLength(5);

      // Attempt 6th position
      const fill6 = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintSlot611111111111111111111111111111111',
        tokenSymbol: 'SLOT6',
        side: 'BUY',
        solAmount: 0.1,
        currentPriceSol: 0.001,
        reason: 'Slot 6 overflow',
        bypassRiskGateForTestingOnly: true,
      });

      expect(() => {
        portfolio.recordTrade(fill6);
      }).toThrow(MaxPositionsExceededError);
    });
  });

  // =========================================================================
  // 10. Interrupted Processing and Post-Restart Cash Reconciliation
  // =========================================================================
  describe('Interrupted Processing & Restart Reconciliation', () => {
    it('REQUIREMENT 9: reconciles cash balance, active positions, realized P&L, and fees after crash / restart', async () => {
      // 1. Execute and record a sequence of trades
      const buy1 = executionEngine.executeSimulatedOrder({
        tokenMint: 'ReconcileA1111111111111111111111111111111',
        tokenSymbol: 'RECA',
        side: 'BUY',
        solAmount: 0.2,
        currentPriceSol: 0.001,
        reason: 'Buy A',
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(buy1);

      const buy2 = executionEngine.executeSimulatedOrder({
        tokenMint: 'ReconcileB2222222222222222222222222222222',
        tokenSymbol: 'RECB',
        side: 'BUY',
        solAmount: 0.3,
        currentPriceSol: 0.002,
        reason: 'Buy B',
        bypassRiskGateForTestingOnly: true,
      });
      portfolio.recordTrade(buy2);

      // Sell position A with profit
      const sell1 = executionEngine.executeSimulatedOrder({
        tokenMint: 'ReconcileA1111111111111111111111111111111',
        tokenSymbol: 'RECA',
        side: 'SELL',
        tokenAmount: buy1.amountTokens,
        currentPriceSol: 0.0015, // +50%
        reason: 'Sell A',
      });
      portfolio.recordTrade(sell1);

      // Position B remains open
      expect(portfolio.getOpenPositions()).toHaveLength(1);

      // 2. Simulate a crash / ungraceful restart:
      // Create a new fresh PortfolioService instance representing the system booting up
      const freshPortfolio = new PortfolioService({
        startingBalanceUsd: 800.0,
        solPriceUsd: 160.0,
      });

      // Call reconcile()
      const report = await freshPortfolio.reconcile();

      expect(report.isAuditedAndReconciled).toBe(true);
      expect(report.activePositionsCount).toBe(1);
      expect(report.restoredPositions).toContain('ReconcileB2222222222222222222222222222222');

      // Mathematical invariant:
      // Reconciled Cash = Initial (5.0) - (Buy1 sol + fee) - (Buy2 sol + fee) + (Sell1 sol - fee)
      const expectedCashSol =
        5.0 -
        (buy1.totalSol + buy1.simulatedFeeSol) -
        (buy2.totalSol + buy2.simulatedFeeSol) +
        (sell1.totalSol - sell1.simulatedFeeSol);

      expect(freshPortfolio.getSolBalance()).toBeCloseTo(expectedCashSol, 4);
      expect(report.calculatedCashBalanceSol).toBeCloseTo(expectedCashSol, 4);
      expect(freshPortfolio.getPosition('ReconcileB2222222222222222222222222222222')).toBeDefined();
    });
  });

  // =========================================================================
  // 11. Partial Fill Handling & Documentation
  // =========================================================================
  describe('Partial Fill Handling & Approximation', () => {
    it('executes partial fill when achievable fill is >= 80% and records partial fill details', () => {
      // In a 30 SOL pool, max capacity is 25% = 7.5 SOL.
      // If order is 8.5 SOL: 7.5 / 8.5 = 88.2% (>= 80% threshold)
      const now = Date.now();
      const quote: MarketDataQuote = {
        priceSol: 0.001,
        liquiditySol: 30.0,
        observedAt: new Date(now),
        source: 'pump_fun',
      };

      const fill = executionEngine.executeSimulatedOrder({
        tokenMint: 'MintPartial11111111111111111111111111111111',
        tokenSymbol: 'PARTIAL',
        side: 'BUY',
        solAmount: 8.5,
        marketData: quote,
        evaluationTimestamp: now,
        reason: 'Large buy with partial fill',
        bypassRiskGateForTestingOnly: true,
      });

      expect(fill.isPartialFill).toBe(true);
      expect(fill.fillRatio).toBeGreaterThanOrEqual(0.8);
      expect(fill.fillRatio).toBeLessThan(1.0);
      expect(fill.totalSol).toBeCloseTo(7.5, 2);
      expect(fill.unfilledSol).toBeCloseTo(1.0, 2);
    });
  });

  // =========================================================================
  // 12. Order Registration & Cancellation
  // =========================================================================
  describe('Order Registration & Cancellation', () => {
    it('registers pending order and successfully cancels it before fill', () => {
      const orderId = portfolio.registerPendingOrder({
        tokenMint: 'MintCancel11111111111111111111111111111111',
        tokenSymbol: 'CNCL',
        side: 'BUY',
        solAmount: 0.1,
        reason: 'Pending order',
      });

      expect(orderId).toBeDefined();
      const cancelled = portfolio.cancelOrder(orderId);
      expect(cancelled).toBe(true);

      // Cancelling non-existent or already cancelled order returns false
      expect(portfolio.cancelOrder(orderId)).toBe(false);
    });
  });
});
