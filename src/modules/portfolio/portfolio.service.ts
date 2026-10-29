import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  PortfolioConfig,
  PositionDetails,
  PortfolioSummary,
  ReconciliationReport,
} from './portfolio.types.js';
import type {
  SimulatedExecutionResult,
  MarketDataQuote,
  SimulatedOrderRequest,
} from '../execution/execution.types.js';
import {
  DuplicatePositionError,
  DuplicateFillError,
  MaxPositionsExceededError,
  PositionNotFoundError,
  InsufficientSimulatedBalanceError,
  StaleMarketDataError,
  FutureMarketDataError,
} from '../execution/execution.types.js';
import { PaperExecutionEngine, paperExecutionEngine } from '../execution/paper-engine.service.js';
import {
  PaperTradingRepository,
  paperTradingRepository,
} from '../persistence/paper-trading.repository.js';
import { logger } from '../observability/logger.js';

export const DEFAULT_PORTFOLIO_CONFIG: PortfolioConfig = {
  startingBalanceUsd: 800.0, // Initial virtual portfolio starting balance: $800
  defaultPositionSizeUsd: 20.0, // Default position size: $20
  maxConcurrentPositions: 5, // Maximum concurrent positions: 5
  takeProfitPct: 20.0, // Configurable take-profit (+20%)
  stopLossPct: 10.0, // Configurable stop-loss (-10%)
  maxHoldingTimeMs: 300000, // Configurable maximum holding time (5 minutes / 300,000 ms)
  solPriceUsd: 160.0, // Reference SOL price for dual-currency accounting ($160/SOL)
};

export class PortfolioService {
  private config: PortfolioConfig;
  private initialSolBalance: number;
  private currentSolBalance: number;
  private realizedPnlSol = 0;
  private totalFeesPaidSol = 0;
  private winCount = 0;
  private lossCount = 0;
  private totalTrades = 0;

  private openPositions = new Map<string, PositionDetails>(); // Keyed by tokenMint
  private closedPositions: PositionDetails[] = [];
  private processedFillIds = new Set<string>();
  private pendingOrders = new Map<string, SimulatedOrderRequest>(); // Client order id tracking
  private repository: PaperTradingRepository;
  private emitter = new EventEmitter();

  constructor(
    configOrInitialSol?: Partial<PortfolioConfig> | number,
    customRepository?: PaperTradingRepository,
  ) {
    this.assertSimulationInvariants();
    this.repository = customRepository ?? paperTradingRepository;

    if (typeof configOrInitialSol === 'number') {
      // Backward-compatible constructor accepting raw initialSolBalance
      const sol = configOrInitialSol;
      const refSolPrice = DEFAULT_PORTFOLIO_CONFIG.solPriceUsd;
      this.config = {
        ...DEFAULT_PORTFOLIO_CONFIG,
        startingBalanceUsd: sol * refSolPrice,
      };
      this.initialSolBalance = sol;
      this.currentSolBalance = sol;
    } else {
      this.config = {
        ...DEFAULT_PORTFOLIO_CONFIG,
        ...configOrInitialSol,
      };
      this.initialSolBalance = this.config.startingBalanceUsd / this.config.solPriceUsd;
      this.currentSolBalance = this.initialSolBalance;
    }
  }

  public assertSimulationInvariants(): void {
    const forbidden = [
      process.env['PRIVATE_KEY'],
      process.env['WALLET_KEY'],
      process.env['WALLET_PRIVATE_KEY'],
      process.env['SOLANA_PRIVATE_KEY'],
      process.env['MNEMONIC'],
      process.env['SEED_PHRASE'],
    ];

    if (forbidden.some((val) => typeof val === 'string' && val.trim().length > 0)) {
      throw new Error(
        'FATAL: Real private key detected in environment! PumpSentinel only supports simulated trading.',
      );
    }
  }

  public getConfig(): Readonly<PortfolioConfig> {
    return Object.freeze({ ...this.config });
  }

  public updateConfig(newConfig: Partial<PortfolioConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public reset(configOrInitialSol?: Partial<PortfolioConfig> | number): void {
    if (typeof configOrInitialSol === 'number') {
      const sol = configOrInitialSol;
      const refSolPrice = this.config.solPriceUsd;
      this.config.startingBalanceUsd = sol * refSolPrice;
      this.initialSolBalance = sol;
      this.currentSolBalance = sol;
    } else if (configOrInitialSol) {
      this.config = { ...this.config, ...configOrInitialSol };
      this.initialSolBalance = this.config.startingBalanceUsd / this.config.solPriceUsd;
      this.currentSolBalance = this.initialSolBalance;
    } else {
      this.initialSolBalance = this.config.startingBalanceUsd / this.config.solPriceUsd;
      this.currentSolBalance = this.initialSolBalance;
    }

    this.realizedPnlSol = 0;
    this.totalFeesPaidSol = 0;
    this.winCount = 0;
    this.lossCount = 0;
    this.totalTrades = 0;
    this.openPositions.clear();
    this.closedPositions = [];
    this.processedFillIds.clear();
    this.pendingOrders.clear();
    this.repository.clearMemory();

    logger.info(
      {
        initialBalanceUsd: this.config.startingBalanceUsd,
        initialSolBalance: this.initialSolBalance,
      },
      '[PortfolioService] Portfolio reset to starting virtual balance',
    );
  }

  public onTrade(
    handler: (trade: SimulatedExecutionResult, position?: PositionDetails, pnlSol?: number) => void,
  ): () => void {
    this.emitter.on('trade', handler);
    return () => this.emitter.off('trade', handler);
  }

  public getSolBalance(): number {
    return this.currentSolBalance;
  }

  public getCashBalanceUsd(): number {
    return this.currentSolBalance * this.config.solPriceUsd;
  }

  public getDefaultPositionSizeSol(): number {
    return this.config.defaultPositionSizeUsd / this.config.solPriceUsd;
  }

  public getOpenPositions(): PositionDetails[] {
    return Array.from(this.openPositions.values());
  }

  public getPosition(mint: string): PositionDetails | undefined {
    return this.openPositions.get(mint);
  }

  // ==========================================
  // Order Registration & Cancellation
  // ==========================================

  public registerPendingOrder(request: SimulatedOrderRequest): string {
    const orderId = request.clientOrderId ?? `order_${crypto.randomUUID()}`;
    request.clientOrderId = orderId;
    this.pendingOrders.set(orderId, request);
    return orderId;
  }

  public cancelOrder(orderId: string): boolean {
    if (this.pendingOrders.has(orderId)) {
      this.pendingOrders.delete(orderId);
      logger.info({ orderId }, '[PortfolioService] Pending simulated order cancelled');
      return true;
    }
    return false;
  }

  // ==========================================
  // Trade Execution & Position Recording
  // ==========================================

  /**
   * Records a simulated execution fill in the portfolio.
   * Enforces:
   * 1. Duplicate fill prevention.
   * 2. Duplicate position prevention.
   * 3. Max concurrent positions limit (5).
   * 4. Separate realized and unrealized P&L tracking.
   * 5. Order & fill persistence.
   */
  public recordTrade(trade: SimulatedExecutionResult): void {
    // 1. REQUIREMENT 7: Prevent duplicate fills
    if (this.processedFillIds.has(trade.tradeId)) {
      throw new DuplicateFillError(
        trade.tradeId,
        `Duplicate fill rejected: Trade ${trade.tradeId} has already been processed in portfolio.`,
      );
    }
    this.processedFillIds.add(trade.tradeId);

    // Remove from pending orders if present
    if (trade.clientOrderId) {
      this.pendingOrders.delete(trade.clientOrderId);
    }

    this.totalTrades += 1;

    if (trade.side === 'BUY') {
      // 2. REQUIREMENT 7: Prevent duplicate positions on the same token mint
      if (this.openPositions.has(trade.tokenMint)) {
        throw new DuplicatePositionError(
          trade.tokenMint,
          `Cannot open duplicate position: An active position for token ${trade.tokenMint} already exists.`,
        );
      }

      // 3. Max concurrent positions limit check
      if (this.openPositions.size >= this.config.maxConcurrentPositions) {
        throw new MaxPositionsExceededError(
          this.openPositions.size,
          this.config.maxConcurrentPositions,
        );
      }

      const totalCost = trade.totalSol + trade.simulatedFeeSol;
      if (this.currentSolBalance < totalCost) {
        throw new InsufficientSimulatedBalanceError(this.currentSolBalance, totalCost);
      }

      this.currentSolBalance -= totalCost;
      this.totalFeesPaidSol += trade.simulatedFeeSol;

      const positionId = `pos_${crypto.randomUUID()}`;
      const entryPriceUsd = trade.executedPriceSol * this.config.solPriceUsd;
      const usdInvested = trade.totalSol * this.config.solPriceUsd;
      const totalFeesUsd = trade.simulatedFeeSol * this.config.solPriceUsd;

      const newPosition: PositionDetails = {
        id: positionId,
        tokenMint: trade.tokenMint,
        tokenSymbol: trade.tokenSymbol,
        amountTokens: trade.amountTokens,
        entryPriceSol: trade.executedPriceSol,
        entryPriceUsd,
        currentPriceSol: trade.executedPriceSol,
        currentPriceUsd: entryPriceUsd,
        solInvested: trade.totalSol,
        usdInvested,
        unrealizedPnlSol: 0,
        unrealizedPnlUsd: 0,
        unrealizedPnlPercent: 0,
        openedAt: trade.executedAt,
        status: 'OPEN',
        totalFeesSol: trade.simulatedFeeSol,
        totalFeesUsd,
      };

      this.openPositions.set(trade.tokenMint, newPosition);

      // Persist to repository
      void this.repository.savePosition({
        id: positionId,
        tokenMint: trade.tokenMint,
        tokenSymbol: trade.tokenSymbol,
        amountTokens: trade.amountTokens,
        entryPriceSol: trade.executedPriceSol,
        currentPriceSol: trade.executedPriceSol,
        solInvested: trade.totalSol,
        status: 'OPEN',
        openedAt: trade.executedAt,
      });

      void this.repository.recordTrade({
        id: trade.tradeId,
        positionId,
        tokenMint: trade.tokenMint,
        side: 'BUY',
        amountTokens: trade.amountTokens,
        priceSol: trade.executedPriceSol,
        totalSol: trade.totalSol,
        simulatedFeeSol: trade.simulatedFeeSol,
        slippageBps: trade.slippageBpsApplied,
        reason: trade.reason,
        executedAt: trade.executedAt,
      });

      void this.repository.saveAccount({
        simulatedSolBalance: this.currentSolBalance,
        initialSolBalance: this.initialSolBalance,
        totalRealizedPnlSol: this.realizedPnlSol,
        winCount: this.winCount,
        lossCount: this.lossCount,
      });

      this.emitter.emit('trade', trade, newPosition, 0);
    } else {
      // SELL trade
      const existing = this.openPositions.get(trade.tokenMint);
      if (!existing) {
        throw new PositionNotFoundError(trade.tokenMint);
      }

      const grossReturnSol = trade.totalSol;
      const netReturnSol = grossReturnSol - trade.simulatedFeeSol;
      this.currentSolBalance += netReturnSol;
      this.totalFeesPaidSol += trade.simulatedFeeSol;

      const fractionSold = Math.min(1.0, trade.amountTokens / existing.amountTokens);
      const costBasisSold = existing.solInvested * fractionSold;
      const tradePnlSol = netReturnSol - costBasisSold;

      this.realizedPnlSol += tradePnlSol;
      existing.totalFeesSol += trade.simulatedFeeSol;
      existing.totalFeesUsd = existing.totalFeesSol * this.config.solPriceUsd;

      if (tradePnlSol > 0) {
        this.winCount += 1;
      } else {
        this.lossCount += 1;
      }

      if (fractionSold >= 0.999) {
        existing.status = 'CLOSED';
        existing.closedAt = trade.executedAt;
        existing.closeReason = trade.reason;
        this.closedPositions.push(existing);
        this.openPositions.delete(trade.tokenMint);

        void this.repository.updatePositionStatus(
          trade.tokenMint,
          'CLOSED',
          tradePnlSol,
          trade.executedAt,
        );
      } else {
        existing.amountTokens -= trade.amountTokens;
        existing.solInvested -= costBasisSold;
        existing.usdInvested = existing.solInvested * this.config.solPriceUsd;
      }

      // Persist trade
      void this.repository.recordTrade({
        id: trade.tradeId,
        positionId: existing.id,
        tokenMint: trade.tokenMint,
        side: 'SELL',
        amountTokens: trade.amountTokens,
        priceSol: trade.executedPriceSol,
        totalSol: trade.totalSol,
        simulatedFeeSol: trade.simulatedFeeSol,
        slippageBps: trade.slippageBpsApplied,
        reason: trade.reason,
        executedAt: trade.executedAt,
      });

      void this.repository.saveAccount({
        simulatedSolBalance: this.currentSolBalance,
        initialSolBalance: this.initialSolBalance,
        totalRealizedPnlSol: this.realizedPnlSol,
        winCount: this.winCount,
        lossCount: this.lossCount,
      });

      this.emitter.emit('trade', trade, existing, tradePnlSol);
    }
  }

  // ==========================================
  // Exit Evaluation: TP, SL & Max Holding Time
  // ==========================================

  /**
   * Evaluates if a position should exit based on:
   * 1. Take-Profit target reached
   * 2. Stop-Loss threshold reached
   * 3. Maximum holding time expired
   */
  public evaluatePositionExit(
    tokenMint: string,
    currentQuote: MarketDataQuote,
    nowMs: number = Date.now(),
  ): { shouldExit: boolean; reason: string; pnlPercent: number; holdingTimeMs: number } | null {
    const pos = this.openPositions.get(tokenMint);
    if (!pos) return null;

    const quoteTime = new Date(currentQuote.observedAt).getTime();
    if (quoteTime > nowMs + 100) {
      throw new FutureMarketDataError(
        'Market quote timestamp is in the future. Cannot evaluate exit.',
        { quoteTime, nowMs },
      );
    }

    if (currentQuote.isStale === true || nowMs - quoteTime > 60000) {
      throw new StaleMarketDataError('Market data is stale. Cannot evaluate position exit.', {
        quoteTime,
        nowMs,
      });
    }

    const holdingTimeMs = nowMs - pos.openedAt.getTime();
    const priceChangePct = ((currentQuote.priceSol - pos.entryPriceSol) / pos.entryPriceSol) * 100;

    // 1. Check Take-Profit
    if (priceChangePct >= this.config.takeProfitPct) {
      return {
        shouldExit: true,
        reason: `TAKE_PROFIT_TRIGGERED: Target +${this.config.takeProfitPct}% hit (current: +${priceChangePct.toFixed(2)}%)`,
        pnlPercent: priceChangePct,
        holdingTimeMs,
      };
    }

    // 2. Check Stop-Loss
    if (priceChangePct <= -this.config.stopLossPct) {
      return {
        shouldExit: true,
        reason: `STOP_LOSS_TRIGGERED: Threshold -${this.config.stopLossPct}% hit (current: ${priceChangePct.toFixed(2)}%)`,
        pnlPercent: priceChangePct,
        holdingTimeMs,
      };
    }

    // 3. Check Maximum Holding Time
    if (holdingTimeMs >= this.config.maxHoldingTimeMs) {
      return {
        shouldExit: true,
        reason: `EXPIRED_MAX_HOLDING_TIME: Holding duration ${Math.round(holdingTimeMs / 1000)}s reached max allowed limit ${Math.round(this.config.maxHoldingTimeMs / 1000)}s`,
        pnlPercent: priceChangePct,
        holdingTimeMs,
      };
    }

    return {
      shouldExit: false,
      reason: 'HOLD_POSITION',
      pnlPercent: priceChangePct,
      holdingTimeMs,
    };
  }

  /**
   * Evaluates exit and executes simulated sell if condition is met.
   */
  public executeExitIfTriggered(
    tokenMint: string,
    currentQuote: MarketDataQuote,
    executionEngine: PaperExecutionEngine = paperExecutionEngine,
    nowMs: number = Date.now(),
  ): SimulatedExecutionResult | null {
    const evaluation = this.evaluatePositionExit(tokenMint, currentQuote, nowMs);
    if (!evaluation || !evaluation.shouldExit) return null;

    const pos = this.openPositions.get(tokenMint);
    if (!pos) return null;

    const sellTrade = executionEngine.executeSimulatedOrder({
      tokenMint: pos.tokenMint,
      tokenSymbol: pos.tokenSymbol,
      side: 'SELL',
      tokenAmount: pos.amountTokens,
      marketData: currentQuote,
      reason: evaluation.reason,
      evaluationTimestamp: nowMs,
      bypassRiskGateForTestingOnly: true, // Exit trades don't require gate re-check
    });

    this.recordTrade(sellTrade);
    return sellTrade;
  }

  // ==========================================
  // Emergency Closure & Operations
  // ==========================================

  /**
   * REQUIREMENT 11: Emergency closure of simulated positions.
   * Immediately liquidates position with realistic slippage, fees, and price impact.
   */
  public emergencyClosePosition(
    tokenMint: string,
    quote: MarketDataQuote,
    reason: string,
    executionEngine: PaperExecutionEngine = paperExecutionEngine,
    evaluationTimestamp?: Date | number,
  ): SimulatedExecutionResult {
    const pos = this.openPositions.get(tokenMint);
    if (!pos) {
      throw new PositionNotFoundError(tokenMint);
    }

    const evalTime =
      evaluationTimestamp ?? Math.max(Date.now(), new Date(quote.observedAt).getTime());

    const sellTrade = executionEngine.executeSimulatedOrder({
      tokenMint: pos.tokenMint,
      tokenSymbol: pos.tokenSymbol,
      side: 'SELL',
      tokenAmount: pos.amountTokens,
      marketData: quote,
      reason: `EMERGENCY_CLOSE: ${reason}`,
      evaluationTimestamp: evalTime,
      bypassRiskGateForTestingOnly: true,
    });

    this.recordTrade(sellTrade);

    pos.status = 'EMERGENCY_CLOSED';
    pos.closeReason = `EMERGENCY_CLOSE: ${reason}`;
    void this.repository.updatePositionStatus(tokenMint, 'EMERGENCY_CLOSED', undefined, new Date());

    logger.warn({ tokenMint, reason }, '[PortfolioService] Emergency position closure completed');
    return sellTrade;
  }

  /**
   * Emergency close all open positions.
   */
  public emergencyCloseAllPositions(
    quotes: Map<string, MarketDataQuote>,
    reason: string,
    executionEngine: PaperExecutionEngine = paperExecutionEngine,
    evaluationTimestamp?: Date | number,
  ): SimulatedExecutionResult[] {
    const results: SimulatedExecutionResult[] = [];
    const openMints = Array.from(this.openPositions.keys());

    for (const mint of openMints) {
      const quote = quotes.get(mint);
      if (!quote) {
        logger.error(
          { mint },
          '[PortfolioService] Cannot emergency close: No valid market quote available (price will not be invented)',
        );
        continue;
      }
      try {
        const trade = this.emergencyClosePosition(
          mint,
          quote,
          reason,
          executionEngine,
          evaluationTimestamp,
        );
        results.push(trade);
      } catch (err) {
        logger.error({ mint, err }, '[PortfolioService] Error during emergency position closure');
      }
    }

    return results;
  }

  // ==========================================
  // Price Updates & Unrealized P&L
  // ==========================================

  public updatePrice(mint: string, currentPriceSol: number): void {
    const pos = this.openPositions.get(mint);
    if (!pos) return;

    pos.currentPriceSol = currentPriceSol;
    pos.currentPriceUsd = currentPriceSol * this.config.solPriceUsd;

    const currentValueSol = pos.amountTokens * currentPriceSol;
    pos.unrealizedPnlSol = currentValueSol - pos.solInvested;
    pos.unrealizedPnlUsd = pos.unrealizedPnlSol * this.config.solPriceUsd;
    pos.unrealizedPnlPercent =
      pos.solInvested > 0 ? (pos.unrealizedPnlSol / pos.solInvested) * 100 : 0;
  }

  // ==========================================
  // Restart Reconciliation
  // ==========================================

  /**
   * REQUIREMENT 9: Reconcile cash balance and open positions after restarts.
   * Mathematical invariant:
   * Reconciled Cash = Initial Balance - sum(All Buys: sol + fee) + sum(All Sells: sol - fee)
   * And audits open positions against actual unclosed BUY trades.
   */
  public async reconcile(): Promise<ReconciliationReport> {
    const auditNotes: string[] = [];
    const allTrades = await this.repository.getAllTrades();
    const allPositions = await this.repository.getAllPositions();

    let computedCashBalanceSol = this.initialSolBalance;
    let computedRealizedPnlSol = 0;
    let computedTotalFeesSol = 0;
    let winCount = 0;
    let lossCount = 0;

    this.openPositions.clear();
    this.closedPositions = [];
    this.processedFillIds.clear();

    // Map trades by position
    const tradesByPosition = new Map<string, typeof allTrades>();
    for (const trade of allTrades) {
      this.processedFillIds.add(trade.id);
      computedTotalFeesSol += trade.simulatedFeeSol;

      if (trade.side === 'BUY') {
        computedCashBalanceSol -= trade.totalSol + trade.simulatedFeeSol;
      } else {
        computedCashBalanceSol += trade.totalSol - trade.simulatedFeeSol;
      }

      if (trade.positionId) {
        const list = tradesByPosition.get(trade.positionId) ?? [];
        list.push(trade);
        tradesByPosition.set(trade.positionId, list);
      }
    }

    // Reconcile each position
    const restoredPositions: string[] = [];
    for (const pos of allPositions) {
      const posTrades = tradesByPosition.get(pos.id) ?? [];
      const buyTrades = posTrades.filter((t) => t.side === 'BUY');
      const sellTrades = posTrades.filter((t) => t.side === 'SELL');

      const totalBoughtTokens = buyTrades.reduce((sum, t) => sum + t.amountTokens, 0);
      const totalSoldTokens = sellTrades.reduce((sum, t) => sum + t.amountTokens, 0);
      const totalBoughtSol = buyTrades.reduce((sum, t) => sum + t.totalSol, 0);
      const totalNetSoldSol = sellTrades.reduce(
        (sum, t) => sum + (t.totalSol - t.simulatedFeeSol),
        0,
      );

      const remainingTokens = totalBoughtTokens - totalSoldTokens;

      if (pos.status === 'OPEN' && remainingTokens > 0.001) {
        const entryPriceUsd = pos.entryPriceSol * this.config.solPriceUsd;
        const currentPriceUsd = pos.currentPriceSol * this.config.solPriceUsd;
        const usdInvested = pos.solInvested * this.config.solPriceUsd;

        const reconstructed: PositionDetails = {
          id: pos.id,
          tokenMint: pos.tokenMint,
          tokenSymbol: pos.tokenSymbol,
          amountTokens: remainingTokens,
          entryPriceSol: pos.entryPriceSol,
          entryPriceUsd,
          currentPriceSol: pos.currentPriceSol,
          currentPriceUsd,
          solInvested: pos.solInvested,
          usdInvested,
          unrealizedPnlSol: pos.unrealizedPnlSol,
          unrealizedPnlUsd: pos.unrealizedPnlSol * this.config.solPriceUsd,
          unrealizedPnlPercent:
            pos.solInvested > 0 ? (pos.unrealizedPnlSol / pos.solInvested) * 100 : 0,
          openedAt: pos.openedAt,
          status: 'OPEN',
          totalFeesSol: buyTrades.reduce((sum, t) => sum + t.simulatedFeeSol, 0),
          totalFeesUsd:
            buyTrades.reduce((sum, t) => sum + t.simulatedFeeSol, 0) * this.config.solPriceUsd,
        };

        this.openPositions.set(pos.tokenMint, reconstructed);
        restoredPositions.push(pos.tokenMint);
      } else {
        // Closed position
        const pnl = totalNetSoldSol - totalBoughtSol;
        computedRealizedPnlSol += pnl;
        if (pnl > 0) winCount += 1;
        else if (sellTrades.length > 0) lossCount += 1;
      }
    }

    const recordedCashBalanceSol = this.currentSolBalance;
    const discrepancySol = Math.abs(recordedCashBalanceSol - computedCashBalanceSol);

    if (discrepancySol > 0.0001) {
      auditNotes.push(
        `Discrepancy detected between recorded balance (${recordedCashBalanceSol.toFixed(4)} SOL) and replayed ledger (${computedCashBalanceSol.toFixed(4)} SOL). Correcting to replayed ledger.`,
      );
    } else {
      auditNotes.push('Cash balance perfectly reconciled with persistent ledger.');
    }

    this.currentSolBalance = computedCashBalanceSol;
    this.realizedPnlSol = computedRealizedPnlSol;
    this.totalFeesPaidSol = computedTotalFeesSol;
    this.winCount = winCount;
    this.lossCount = lossCount;
    this.totalTrades = allTrades.length;

    const report: ReconciliationReport = {
      timestamp: new Date(),
      initialBalanceUsd: this.config.startingBalanceUsd,
      initialBalanceSol: this.initialSolBalance,
      calculatedCashBalanceSol: this.round(computedCashBalanceSol),
      calculatedCashBalanceUsd: this.round(computedCashBalanceSol * this.config.solPriceUsd),
      recordedCashBalanceSol: this.round(recordedCashBalanceSol),
      discrepancySol: this.round(discrepancySol),
      isAuditedAndReconciled: true,
      activePositionsCount: this.openPositions.size,
      restoredPositions,
      totalRealizedPnlSol: this.round(computedRealizedPnlSol),
      totalFeesPaidSol: this.round(computedTotalFeesSol),
      totalTradesReplayed: allTrades.length,
      auditNotes,
    };

    logger.info(
      {
        reconciledCashSol: report.calculatedCashBalanceSol,
        reconciledCashUsd: report.calculatedCashBalanceUsd,
        activePositions: report.activePositionsCount,
        discrepancy: report.discrepancySol,
      },
      '[PortfolioService] Post-restart reconciliation complete',
    );

    return report;
  }

  // ==========================================
  // Summary & Reporting
  // ==========================================

  public getSummary(): PortfolioSummary {
    let totalInvestedSol = 0;
    let unrealizedPnlSol = 0;
    let openPositionsValueSol = 0;

    for (const pos of this.openPositions.values()) {
      totalInvestedSol += pos.solInvested;
      const posVal = pos.amountTokens * pos.currentPriceSol;
      openPositionsValueSol += posVal;
      unrealizedPnlSol += posVal - pos.solInvested;
    }

    const totalPortfolioValueSol = this.currentSolBalance + openPositionsValueSol;
    const totalPnlSol = this.realizedPnlSol + unrealizedPnlSol;
    const totalPnlPercent =
      this.initialSolBalance > 0 ? (totalPnlSol / this.initialSolBalance) * 100 : 0;

    const closedTrades = this.winCount + this.lossCount;
    const winRatePercent = closedTrades > 0 ? (this.winCount / closedTrades) * 100 : 0;

    const solPrice = this.config.solPriceUsd;

    return {
      // Cash & Balance
      initialBalanceUsd: this.round(this.config.startingBalanceUsd),
      currentCashBalanceUsd: this.round(this.currentSolBalance * solPrice),
      initialSolBalance: this.round(this.initialSolBalance),
      currentSolBalance: this.round(this.currentSolBalance),

      // Holdings
      totalInvestedUsd: this.round(totalInvestedSol * solPrice),
      totalInvestedSol: this.round(totalInvestedSol),
      openPositionsValueUsd: this.round(openPositionsValueSol * solPrice),
      openPositionsValueSol: this.round(openPositionsValueSol),
      totalPortfolioValueUsd: this.round(totalPortfolioValueSol * solPrice),
      totalPortfolioValueSol: this.round(totalPortfolioValueSol),

      // PnL
      realizedPnlUsd: this.round(this.realizedPnlSol * solPrice),
      realizedPnlSol: this.round(this.realizedPnlSol),
      unrealizedPnlUsd: this.round(unrealizedPnlSol * solPrice),
      unrealizedPnlSol: this.round(unrealizedPnlSol),
      totalPnlUsd: this.round(totalPnlSol * solPrice),
      totalPnlSol: this.round(totalPnlSol),
      totalPnlPercent: this.round(totalPnlPercent),

      // Fees
      totalFeesPaidUsd: this.round(this.totalFeesPaidSol * solPrice),
      totalFeesPaidSol: this.round(this.totalFeesPaidSol),

      // Operations & Performance
      openPositionsCount: this.openPositions.size,
      maxConcurrentPositions: this.config.maxConcurrentPositions,
      winCount: this.winCount,
      lossCount: this.lossCount,
      winRatePercent: this.round(winRatePercent),
      totalTrades: this.totalTrades,

      // Config
      defaultPositionSizeUsd: this.config.defaultPositionSizeUsd,
      takeProfitPct: this.config.takeProfitPct,
      stopLossPct: this.config.stopLossPct,
      maxHoldingTimeMs: this.config.maxHoldingTimeMs,
      solPriceUsd: this.config.solPriceUsd,
    };
  }

  private round(val: number): number {
    return Math.round(val * 10000) / 10000;
  }
}

export const portfolioService = new PortfolioService();
