import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  SimulatedOrderRequest,
  SimulatedExecutionResult,
  PaperExecutionConfig,
} from './execution.types.js';
import {
  UnrealisticExecutionError,
  StaleMarketDataError,
  FutureMarketDataError,
} from './execution.types.js';
import { logger } from '../observability/logger.js';
import { riskDecisionGate } from '../risk/risk-decision-gate.js';
import { RiskGateInvariantViolationError } from '../risk/risk.types.js';

export class PaperExecutionEngine {
  private emitter = new EventEmitter();
  private config: PaperExecutionConfig;

  constructor(config?: Partial<PaperExecutionConfig>) {
    // Assert zero possibility of private key / live signing
    this.assertSimulationInvariants();

    const networkFee = config?.simulatedNetworkFeeSol ?? config?.simulatedFeeSol ?? 0.005;

    this.config = {
      defaultSlippageBps: config?.defaultSlippageBps ?? 150, // 1.5% default
      simulatedNetworkFeeSol: networkFee,
      simulatedFeeSol: networkFee,
      swapFeePct: config?.swapFeePct ?? 1.0, // 1.0% DEX swap fee
      maxAllowedPriceImpactPct: config?.maxAllowedPriceImpactPct ?? 35.0, // 35% max price impact
      maxOrderToLiquidityRatio: config?.maxOrderToLiquidityRatio ?? 0.25, // Max 25% of pool
      minPoolLiquiditySol: config?.minPoolLiquiditySol ?? 15.0, // Min 15 SOL pool depth
      maxMarketDataAgeMs: config?.maxMarketDataAgeMs ?? 60000, // 60 seconds max staleness
      minFillRatio: config?.minFillRatio ?? 0.8, // 80% minimum partial fill or kill
      solPriceUsd: config?.solPriceUsd ?? 160.0, // Default $160 / SOL
    };
  }

  public getConfig(): Readonly<PaperExecutionConfig> {
    return Object.freeze({ ...this.config });
  }

  public updateConfig(newConfig: Partial<PaperExecutionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * REQUIREMENT 1 & 2: Never create or sign real trading transactions. Never request a wallet private key.
   */
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

  public onTradeExecuted(handler: (trade: SimulatedExecutionResult) => void): () => void {
    this.emitter.on('trade', handler);
    return () => {
      this.emitter.off('trade', handler);
    };
  }

  /**
   * Execute a simulated trade strictly in paper-trading mode.
   * FINAL INVARIANT: No token can be purchased by the paper-trading engine unless
   * it has passed the required risk gate and the entry strategy.
   */
  public executeSimulatedOrder(request: SimulatedOrderRequest): SimulatedExecutionResult {
    this.assertSimulationInvariants();

    const evalTime = request.evaluationTimestamp
      ? new Date(request.evaluationTimestamp).getTime()
      : Date.now();

    // 1. Resolve base price, liquidity, and quote observation timestamp
    let basePriceSol: number;
    let poolLiquiditySol: number;
    let marketObservedAt: Date;
    let hasExplicitMarketData = false;

    if (request.marketData) {
      hasExplicitMarketData = true;
      const quote = request.marketData;
      const quoteTime = new Date(quote.observedAt).getTime();

      // REQUIREMENT 12: Never use future market data to determine past fills.
      if (quoteTime > evalTime + 100) {
        throw new FutureMarketDataError(
          `Market data timestamp (${new Date(quoteTime).toISOString()}) is in the future relative to evaluation time (${new Date(evalTime).toISOString()}). Look-ahead bias prohibited.`,
          { quoteTime, evalTime, tokenMint: request.tokenMint },
        );
      }

      // Staleness check: If market data is stale or unavailable, do not invent a price.
      if (quote.isStale === true || evalTime - quoteTime > this.config.maxMarketDataAgeMs) {
        throw new StaleMarketDataError(
          `Market data for ${request.tokenMint} is stale (age: ${evalTime - quoteTime}ms > ${this.config.maxMarketDataAgeMs}ms). Price will not be invented.`,
          { quoteAgeMs: evalTime - quoteTime, tokenMint: request.tokenMint },
        );
      }

      if (!quote.priceSol || quote.priceSol <= 0) {
        throw new StaleMarketDataError(
          `Market price for ${request.tokenMint} is unavailable or non-positive (${quote.priceSol}). Price will not be invented.`,
          { priceSol: quote.priceSol, tokenMint: request.tokenMint },
        );
      }

      // Check pool liquidity
      if (quote.liquiditySol < this.config.minPoolLiquiditySol) {
        throw new UnrealisticExecutionError(
          'INSUFFICIENT_POOL_LIQUIDITY',
          `Pool liquidity of ${quote.liquiditySol.toFixed(2)} SOL is below minimum realistic threshold of ${this.config.minPoolLiquiditySol} SOL. Execution rejected.`,
          { liquiditySol: quote.liquiditySol, minRequired: this.config.minPoolLiquiditySol },
        );
      }

      basePriceSol = quote.priceSol;
      poolLiquiditySol = quote.liquiditySol;
      marketObservedAt = new Date(quote.observedAt);
    } else {
      // Legacy / simple mode fallback without explicit MarketDataQuote
      if (typeof request.currentPriceSol !== 'number' || request.currentPriceSol <= 0) {
        throw new StaleMarketDataError(
          `Current price for ${request.tokenMint} is unavailable or non-positive. Execution rejected.`,
          { currentPriceSol: request.currentPriceSol },
        );
      }
      basePriceSol = request.currentPriceSol;
      poolLiquiditySol = 30.0; // Default standard bonding curve reserve
      marketObservedAt = new Date(evalTime);
    }

    const slippageBps = request.maxSlippageBps ?? this.config.defaultSlippageBps;
    const slippageMultiplier = slippageBps / 10000;

    let executedPriceSol: number;
    let amountTokens: number;
    let totalSol: number;
    let priceImpactPct = 0;
    let isPartialFill = false;
    let fillRatio = 1.0;
    let requestedTokens: number | undefined;
    let requestedSol: number | undefined;
    let unfilledTokens = 0;
    let unfilledSol = 0;
    const networkFeeSol = this.config.simulatedNetworkFeeSol;
    let swapFeeSol = 0;

    if (request.side === 'BUY') {
      requestedSol = request.solAmount;
      if (!requestedSol || requestedSol <= 0) {
        throw new Error('solAmount must be positive for BUY orders');
      }

      // FINAL INVARIANT ENFORCEMENT
      if (!request.bypassRiskGateForTestingOnly) {
        // 1. Verify Risk Gate Eligibility
        riskDecisionGate.assertEligibleForPurchase(request.tokenMint, request.riskDecision);

        // 2. Verify Entry Strategy Clearance
        if (!request.strategySignal || request.strategySignal.action !== 'BUY') {
          throw new RiskGateInvariantViolationError(
            `Invariant violation: Cannot execute paper BUY for token ${request.tokenMint}. Order must be approved by entry strategy with action 'BUY' (received: ${request.strategySignal?.action ?? 'NONE'}).`,
            {
              mint: request.tokenMint,
              strategySignal: request.strategySignal,
            },
          );
        }
      }

      if (hasExplicitMarketData) {
        // Realistic Constant-Product AMM execution simulation
        // 1. Capacity check: Max order size as fraction of pool
        const maxCapacitySol = poolLiquiditySol * this.config.maxOrderToLiquidityRatio;
        const capacityFillRatio = maxCapacitySol / requestedSol;

        // 2. Price impact check:
        // impact(s) = s / (pool + s)
        // If requestedSol causes impact > maxAllowedPriceImpactPct:
        const maxImpactRatio = this.config.maxAllowedPriceImpactPct / 100;
        const maxImpactSol = (maxImpactRatio * poolLiquiditySol) / (1 - maxImpactRatio);
        const impactFillRatio = maxImpactSol / requestedSol;

        const effectiveFillRatio = Math.min(1.0, capacityFillRatio, impactFillRatio);

        if (effectiveFillRatio < this.config.minFillRatio) {
          const reasonCode =
            capacityFillRatio < impactFillRatio
              ? 'ORDER_EXCEEDS_POOL_CAPACITY'
              : 'EXCESSIVE_PRICE_IMPACT';
          throw new UnrealisticExecutionError(
            reasonCode,
            `Simulated BUY of ${requestedSol} SOL cannot achieve minimum fill threshold of ${(this.config.minFillRatio * 100).toFixed(0)}% (achievable: ${(effectiveFillRatio * 100).toFixed(1)}%). Execution rejected.`,
            {
              requestedSol,
              poolLiquiditySol,
              effectiveFillRatio,
              minFillRatio: this.config.minFillRatio,
            },
          );
        }

        fillRatio = effectiveFillRatio;
        isPartialFill = fillRatio < 0.9999;
        totalSol = requestedSol * fillRatio;
        unfilledSol = requestedSol - totalSol;

        // Constant product price impact: impact = fillSol / (poolSol + fillSol)
        priceImpactPct = (totalSol / (poolLiquiditySol + totalSol)) * 100;

        // Effective BUY execution price: basePrice * (1 + impact) * (1 + slippage)
        const impactMultiplier = 1 + priceImpactPct / 100;
        const totalMultiplier = impactMultiplier * (1 + slippageMultiplier);
        executedPriceSol = basePriceSol * totalMultiplier;

        amountTokens = totalSol / executedPriceSol;
        requestedTokens = requestedSol / (basePriceSol * (1 + slippageMultiplier));
        unfilledTokens = Math.max(0, requestedTokens - amountTokens);

        swapFeeSol = totalSol * (this.config.swapFeePct / 100);
      } else {
        // Backward-compatible simple execution
        executedPriceSol = basePriceSol * (1 + slippageMultiplier);
        totalSol = requestedSol;
        amountTokens = totalSol / executedPriceSol;
        swapFeeSol = 0; // Legacy mode used single simulatedFeeSol
      }
    } else {
      // SELL trade
      requestedTokens = request.tokenAmount;
      if (!requestedTokens || requestedTokens <= 0) {
        throw new Error('tokenAmount must be positive for SELL orders');
      }

      if (hasExplicitMarketData) {
        const nominalSolValue = requestedTokens * basePriceSol;

        // Capacity and impact checks
        const maxCapacitySol = poolLiquiditySol * this.config.maxOrderToLiquidityRatio;
        const capacityFillRatio = maxCapacitySol / nominalSolValue;

        const maxImpactRatio = this.config.maxAllowedPriceImpactPct / 100;
        const maxImpactSol = (maxImpactRatio * poolLiquiditySol) / (1 - maxImpactRatio);
        const impactFillRatio = maxImpactSol / nominalSolValue;

        const effectiveFillRatio = Math.min(1.0, capacityFillRatio, impactFillRatio);

        if (effectiveFillRatio < this.config.minFillRatio) {
          const reasonCode =
            capacityFillRatio < impactFillRatio
              ? 'ORDER_EXCEEDS_POOL_CAPACITY'
              : 'EXCESSIVE_PRICE_IMPACT';
          throw new UnrealisticExecutionError(
            reasonCode,
            `Simulated SELL cannot achieve minimum fill threshold of ${(this.config.minFillRatio * 100).toFixed(0)}% (achievable: ${(effectiveFillRatio * 100).toFixed(1)}%). Execution rejected.`,
            {
              requestedTokens,
              nominalSolValue,
              effectiveFillRatio,
              minFillRatio: this.config.minFillRatio,
            },
          );
        }

        fillRatio = effectiveFillRatio;
        isPartialFill = fillRatio < 0.9999;
        amountTokens = requestedTokens * fillRatio;
        unfilledTokens = requestedTokens - amountTokens;

        const effectiveSolValue = amountTokens * basePriceSol;
        priceImpactPct = (effectiveSolValue / (poolLiquiditySol + effectiveSolValue)) * 100;

        // Effective SELL execution price: basePrice * (1 - impact) * (1 - slippage)
        const impactMultiplier = Math.max(0.01, 1 - priceImpactPct / 100);
        const totalMultiplier = impactMultiplier * (1 - slippageMultiplier);
        executedPriceSol = basePriceSol * totalMultiplier;

        if (executedPriceSol <= 0) {
          throw new UnrealisticExecutionError(
            'NON_POSITIVE_PRICE',
            `Simulated SELL produced non-positive execution price (${executedPriceSol}).`,
          );
        }

        totalSol = amountTokens * executedPriceSol;
        unfilledSol = unfilledTokens * executedPriceSol;
        swapFeeSol = totalSol * (this.config.swapFeePct / 100);
      } else {
        // Backward-compatible simple execution
        executedPriceSol = basePriceSol * (1 - slippageMultiplier);
        amountTokens = requestedTokens;
        totalSol = amountTokens * executedPriceSol;
        swapFeeSol = 0;
      }
    }

    const simulatedFeeSol = networkFeeSol + swapFeeSol;
    const tradeId = `sim_${crypto.randomUUID()}`;

    const result: SimulatedExecutionResult = {
      tradeId,
      clientOrderId: request.clientOrderId,
      tokenMint: request.tokenMint,
      tokenSymbol: request.tokenSymbol,
      side: request.side,
      requestedPriceSol: basePriceSol,
      executedPriceSol,
      requestedTokens,
      amountTokens,
      requestedSol,
      totalSol,
      simulatedFeeSol,
      networkFeeSol,
      swapFeeSol,
      slippageBpsApplied: slippageBps,
      priceImpactPct,
      isPartialFill,
      unfilledTokens: isPartialFill ? unfilledTokens : undefined,
      unfilledSol: isPartialFill ? unfilledSol : undefined,
      fillRatio,
      marketObservedAt,
      executedAt: new Date(evalTime),
      reason: request.reason,
      isSimulated: true,
    };

    logger.info(
      {
        tradeId,
        side: result.side,
        mint: result.tokenMint,
        tokens: result.amountTokens,
        priceSol: result.executedPriceSol,
        totalSol: result.totalSol,
        impactPct: result.priceImpactPct,
        isPartial: result.isPartialFill,
        feeSol: result.simulatedFeeSol,
      },
      '[PaperExecutionEngine] Simulated trade executed',
    );

    this.emitter.emit('trade', result);
    return result;
  }
}

export const paperExecutionEngine = new PaperExecutionEngine();
