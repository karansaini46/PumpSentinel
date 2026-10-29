import type { RiskGateDecision } from '../risk/risk.types.js';
import type { StrategySignal } from '../strategy/strategy.types.js';

export type SimulatedTradeSide = 'BUY' | 'SELL';

export type UnrealisticExecutionReasonCode =
  | 'EXCESSIVE_PRICE_IMPACT'
  | 'ORDER_EXCEEDS_POOL_CAPACITY'
  | 'INSUFFICIENT_POOL_LIQUIDITY'
  | 'SLIPPAGE_TOLERANCE_EXCEEDED'
  | 'NON_POSITIVE_PRICE';

/**
 * Timestamped market quote used for realistic paper execution simulation.
 * Never invent a price: if missing or stale, execution must be rejected.
 */
export interface MarketDataQuote {
  priceSol: number;
  liquiditySol: number; // e.g. bonding curve SOL reserves or pool liquidity
  marketCapSol?: number;
  observedAt: Date | number;
  source: string;
  isStale?: boolean;
  confidence?: number;
}

export interface SimulatedOrderRequest {
  clientOrderId?: string;
  tokenMint: string;
  tokenSymbol: string;
  side: SimulatedTradeSide;
  solAmount?: number; // For BUY in SOL
  usdAmount?: number; // Optional USD equivalent
  tokenAmount?: number; // For SELL in token units
  currentPriceSol?: number; // Fallback / legacy price if marketData not provided
  marketData?: MarketDataQuote; // Timestamped quote for realistic pricing
  maxSlippageBps?: number;
  reason: string;
  riskDecision?: RiskGateDecision;
  strategySignal?: StrategySignal;
  bypassRiskGateForTestingOnly?: boolean;
  evaluationTimestamp?: Date | number; // Anti-lookahead timestamp (defaults to current time)
}

export interface SimulatedExecutionResult {
  tradeId: string;
  clientOrderId?: string;
  tokenMint: string;
  tokenSymbol: string;
  side: SimulatedTradeSide;
  requestedPriceSol: number;
  executedPriceSol: number;
  requestedTokens?: number;
  amountTokens: number; // Filled tokens
  requestedSol?: number;
  totalSol: number; // Filled SOL amount (gross)
  simulatedFeeSol: number; // Total simulated fee (network + swap)
  networkFeeSol?: number; // Solana base/priority fee simulation
  swapFeeSol?: number; // Protocol / pool trading fee simulation
  slippageBpsApplied: number;
  priceImpactPct?: number;
  isPartialFill?: boolean;
  unfilledTokens?: number;
  unfilledSol?: number;
  fillRatio?: number; // 0.0 - 1.0 (e.g. 1.0 = 100% full fill)
  marketObservedAt?: Date;
  executedAt: Date;
  reason: string;
  isSimulated: true; // Hardcoded guarantee: Never live
}

export interface PaperExecutionConfig {
  defaultSlippageBps: number; // default 150 (1.5%)
  simulatedNetworkFeeSol: number; // default 0.005 SOL
  simulatedFeeSol?: number; // legacy alias for backward compatibility
  swapFeePct: number; // default 1.0% (100 bps)
  maxAllowedPriceImpactPct: number; // default 35.0%
  maxOrderToLiquidityRatio: number; // default 0.25 (25% of pool)
  minPoolLiquiditySol: number; // default 15.0 SOL
  maxMarketDataAgeMs: number; // default 60000 ms (60 seconds)
  minFillRatio: number; // default 0.80 (80% minimum partial fill or kill)
  solPriceUsd: number; // default 160.0 USD/SOL
}

// ==========================================
// Specialized Simulation Errors
// ==========================================

export class UnrealisticExecutionError extends Error {
  public readonly reasonCode: UnrealisticExecutionReasonCode;
  public readonly details: Record<string, unknown>;

  constructor(
    reasonCode: UnrealisticExecutionReasonCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`[UnrealisticExecution: ${reasonCode}] ${message}`);
    this.name = 'UnrealisticExecutionError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export class StaleMarketDataError extends Error {
  public readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(`[StaleMarketData] ${message}`);
    this.name = 'StaleMarketDataError';
    this.details = details;
  }
}

export class FutureMarketDataError extends Error {
  public readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(`[FutureMarketDataViolation] ${message}`);
    this.name = 'FutureMarketDataError';
    this.details = details;
  }
}

export class DuplicatePositionError extends Error {
  public readonly tokenMint: string;

  constructor(tokenMint: string, message: string) {
    super(`[DuplicatePosition] ${message}`);
    this.name = 'DuplicatePositionError';
    this.tokenMint = tokenMint;
  }
}

export class DuplicateFillError extends Error {
  public readonly fillId: string;

  constructor(fillId: string, message: string) {
    super(`[DuplicateFill] ${message}`);
    this.name = 'DuplicateFillError';
    this.fillId = fillId;
  }
}

export class DuplicateOrderError extends Error {
  public readonly orderId: string;

  constructor(orderId: string, message: string) {
    super(`[DuplicateOrder] ${message}`);
    this.name = 'DuplicateOrderError';
    this.orderId = orderId;
  }
}

export class MaxPositionsExceededError extends Error {
  public readonly currentCount: number;
  public readonly maxAllowed: number;

  constructor(currentCount: number, maxAllowed: number) {
    super(
      `[MaxPositionsExceeded] Cannot open new position: concurrent positions (${currentCount}) has reached max capacity (${maxAllowed}).`,
    );
    this.name = 'MaxPositionsExceededError';
    this.currentCount = currentCount;
    this.maxAllowed = maxAllowed;
  }
}

export class HoldingTimeExpiredError extends Error {
  public readonly tokenMint: string;
  public readonly holdingTimeMs: number;
  public readonly maxHoldingTimeMs: number;

  constructor(tokenMint: string, holdingTimeMs: number, maxHoldingTimeMs: number) {
    super(
      `[HoldingTimeExpired] Position for token ${tokenMint} exceeded max holding time (${holdingTimeMs}ms > ${maxHoldingTimeMs}ms).`,
    );
    this.name = 'HoldingTimeExpiredError';
    this.tokenMint = tokenMint;
    this.holdingTimeMs = holdingTimeMs;
    this.maxHoldingTimeMs = maxHoldingTimeMs;
  }
}

export class PositionNotFoundError extends Error {
  public readonly tokenMint: string;

  constructor(tokenMint: string) {
    super(`[PositionNotFound] No active paper position found for token mint ${tokenMint}.`);
    this.name = 'PositionNotFoundError';
    this.tokenMint = tokenMint;
  }
}

export class InsufficientSimulatedBalanceError extends Error {
  public readonly currentBalance: number;
  public readonly requiredBalance: number;

  constructor(currentBalance: number, requiredBalance: number) {
    super(
      `[InsufficientSimulatedBalance] Insufficient simulated cash balance: available ${currentBalance.toFixed(4)}, required ${requiredBalance.toFixed(4)}.`,
    );
    this.name = 'InsufficientSimulatedBalanceError';
    this.currentBalance = currentBalance;
    this.requiredBalance = requiredBalance;
  }
}
