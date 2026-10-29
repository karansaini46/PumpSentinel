import type { MarketDataQuote, SimulatedExecutionResult } from '../execution/execution.types.js';

export interface PortfolioRiskConfig {
  /**
   * Maximum single position size in SOL. Default: 1.0 SOL.
   */
  maxPositionSizeSol: number;

  /**
   * Optional maximum single position size in USD. Default: $160.0.
   */
  maxPositionSizeUsd?: number;

  /**
   * Maximum concurrent open positions allowed. Default: 5.
   */
  maxConcurrentPositions: number;

  /**
   * Maximum total portfolio exposure across all open positions in SOL. Default: 4.0 SOL.
   */
  maxTotalExposureSol: number;

  /**
   * Maximum total portfolio exposure as a percentage of total portfolio equity. Default: 80.0%.
   */
  maxTotalExposurePct: number;

  /**
   * Maximum daily simulated loss percentage of starting daily equity. Initial experimental: 10.0%.
   */
  maxDailyLossPct: number;

  /**
   * Maximum portfolio drawdown percentage from peak equity. Default: 15.0%.
   */
  maxDrawdownPct: number;

  /**
   * Configurable stop-loss percentage. Initial experimental: 10.0% (-10%).
   */
  stopLossPct: number;

  /**
   * Configurable take-profit percentage. Initial experimental: 20.0% (+20%).
   */
  takeProfitPct: number;

  /**
   * Configurable maximum holding duration in ms. Initial experimental: 5 minutes (300,000 ms).
   */
  maxHoldingDurationMs: number;

  /**
   * Reference SOL price in USD. Default: 160.0.
   */
  solPriceUsd: number;

  /**
   * Automatically pause trading if an emergency exit occurs. Default: true.
   */
  pauseOnEmergencyExit: boolean;

  /**
   * Automatically pause trading if daily loss limit is breached. Default: true.
   */
  pauseOnDailyLossBreach: boolean;

  /**
   * Automatically pause trading if drawdown limit is breached. Default: true.
   */
  pauseOnDrawdownBreach: boolean;
}

export const DEFAULT_PORTFOLIO_RISK_CONFIG: PortfolioRiskConfig = {
  maxPositionSizeSol: 1.0,
  maxPositionSizeUsd: 160.0,
  maxConcurrentPositions: 5,
  maxTotalExposureSol: 4.0,
  maxTotalExposurePct: 80.0,
  maxDailyLossPct: 10.0, // Configurable % of starting daily equity
  maxDrawdownPct: 15.0,
  stopLossPct: 10.0, // Initial experimental value: 10%
  takeProfitPct: 20.0, // Initial experimental value: 20%
  maxHoldingDurationMs: 300000, // Initial experimental value: 5 minutes (300,000 ms)
  solPriceUsd: 160.0,
  pauseOnEmergencyExit: true,
  pauseOnDailyLossBreach: true,
  pauseOnDrawdownBreach: true,
};

export type PauseTrigger =
  'MANUAL' | 'DAILY_LOSS' | 'DRAWDOWN' | 'EMERGENCY_EXIT' | 'RECONCILIATION_BREACH';

export interface TradingPauseDetails {
  isPaused: boolean;
  reason: string | null;
  pausedAt: Date | null;
  trigger: PauseTrigger | null;
}

export interface PortfolioEquityMetrics {
  timestamp: Date;
  cashBalanceSol: number;
  cashBalanceUsd: number;
  openPositionsValueSol: number;
  openPositionsValueUsd: number;
  totalEquitySol: number;
  totalEquityUsd: number;
  peakEquitySol: number;
  peakEquityUsd: number;
  currentDrawdownSol: number;
  currentDrawdownPct: number;
  dailyStartingEquitySol: number;
  dailyStartingEquityUsd: number;
  dailyLossSol: number;
  dailyLossPct: number;
  totalExposureSol: number;
  totalExposurePct: number;
  openPositionsCount: number;
  isDailyLossBreached: boolean;
  isDrawdownBreached: boolean;
  isTradingPaused: boolean;
}

export type PreOrderRejectionReason =
  | 'TRADING_PAUSED'
  | 'DAILY_LOSS_EXCEEDED'
  | 'DRAWDOWN_EXCEEDED'
  | 'MAX_POSITIONS_EXCEEDED'
  | 'DUPLICATE_POSITION'
  | 'POSITION_SIZE_EXCEEDED'
  | 'TOTAL_EXPOSURE_EXCEEDED'
  | 'INSUFFICIENT_BALANCE';

export interface PreOrderValidationResult {
  allowed: boolean;
  rejectionReason?: PreOrderRejectionReason;
  rejectionMessage?: string;
  metrics?: Partial<PortfolioEquityMetrics>;
}

export type ExitTriggerReason =
  | 'STOP_LOSS_TRIGGERED'
  | 'TAKE_PROFIT_TRIGGERED'
  | 'MAX_HOLDING_DURATION_EXPIRED'
  | 'EMERGENCY_EXIT_TRIGGERED'
  | 'HOLD_POSITION';

export interface ExitEvaluationResult {
  shouldExit: boolean;
  triggerReason: ExitTriggerReason;
  reasonMessage: string;
  pnlPercent: number;
  holdingDurationMs: number;
  isEmergency: boolean;
  isStopLoss: boolean;
  isTakeProfit: boolean;
  isHoldingExpired: boolean;
  currentQuote: MarketDataQuote;
}

export interface ExitPendingDetails {
  tokenMint: string;
  tokenSymbol: string;
  amountTokens: number;
  reason: string;
  failureReason: string;
  failedAttempts: number;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  lastKnownQuote?: MarketDataQuote;
}

export interface ExitExecutionResult {
  status: 'FILLED' | 'EXIT_PENDING' | 'SKIPPED_CONCURRENT' | 'FAILED';
  trade?: SimulatedExecutionResult;
  exitPending?: ExitPendingDetails;
  error?: string;
}

export interface EmergencyExitSummary {
  timestamp: Date;
  reason: string;
  totalEvaluated: number;
  filledExits: number;
  pendingExits: number;
  failedExits: number;
  trades: SimulatedExecutionResult[];
  pendingPositions: ExitPendingDetails[];
}

export type InconsistencyType =
  | 'CASH_DISCREPANCY'
  | 'GHOST_OPEN_POSITION'
  | 'DANGLING_CLOSED_POSITION'
  | 'MISSING_IN_MEMORY_POSITION'
  | 'UNPERSISTED_MEMORY_POSITION'
  | 'POSITION_AMOUNT_MISMATCH'
  | 'EXIT_PENDING_SYNC'
  | 'ORPHANED_TRADE'
  | 'DUPLICATE_TRADE';

export interface InconsistencyRecord {
  type: InconsistencyType;
  severity: 'WARNING' | 'CRITICAL';
  description: string;
  tokenMint?: string;
  positionId?: string;
  tradeId?: string;
  expectedValue?: unknown;
  actualValue?: unknown;
  resolutionApplied?: string;
}

export interface PortfolioReconciliationResult {
  timestamp: Date;
  status: 'CLEAN' | 'DISCREPANCIES_RESOLVED' | 'UNRESOLVED_ERRORS';
  isAuditedAndReconciled: boolean;
  inconsistenciesDetected: InconsistencyRecord[];
  cashAudit: {
    recordedBalanceSol: number;
    dbAccountBalanceSol: number;
    replayedLedgerSol: number;
    discrepancySol: number;
    reconciledBalanceSol: number;
  };
  positionsAudit: {
    dbPositionsCount: number;
    memoryPositionsCount: number;
    reconstructedOpenCount: number;
    reconstructedClosedCount: number;
    exitPendingCount: number;
    orphanedTradesCount: number;
  };
  repairedIssues: string[];
  auditNotes: string[];
}

// ==========================================
// Specialized Portfolio Risk Errors
// ==========================================

export class PortfolioRiskViolationError extends Error {
  public readonly reason: PreOrderRejectionReason;
  public readonly details: Record<string, unknown>;

  constructor(
    reason: PreOrderRejectionReason,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`[PortfolioRiskViolation: ${reason}] ${message}`);
    this.name = 'PortfolioRiskViolationError';
    this.reason = reason;
    this.details = details;
  }
}

export class TradingPausedError extends PortfolioRiskViolationError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('TRADING_PAUSED', message, details);
    this.name = 'TradingPausedError';
  }
}

export class MaxPositionSizeExceededError extends PortfolioRiskViolationError {
  constructor(requestedSize: number, maxSize: number, unit = 'SOL') {
    super(
      'POSITION_SIZE_EXCEEDED',
      `Requested position size of ${requestedSize.toFixed(4)} ${unit} exceeds maximum allowed limit of ${maxSize.toFixed(4)} ${unit}.`,
      { requestedSize, maxSize, unit },
    );
    this.name = 'MaxPositionSizeExceededError';
  }
}

export class MaxConcurrentPositionsExceededError extends PortfolioRiskViolationError {
  constructor(currentCount: number, maxCount: number) {
    super(
      'MAX_POSITIONS_EXCEEDED',
      `Cannot open new position: concurrent open positions (${currentCount}) has reached max capacity (${maxCount}).`,
      { currentCount, maxCount },
    );
    this.name = 'MaxConcurrentPositionsExceededError';
  }
}

export class MaxTotalExposureExceededError extends PortfolioRiskViolationError {
  constructor(newExposure: number, maxExposure: number, unit = 'SOL') {
    super(
      'TOTAL_EXPOSURE_EXCEEDED',
      `Projected total portfolio exposure of ${newExposure.toFixed(4)} ${unit} exceeds maximum allowed limit of ${maxExposure.toFixed(4)} ${unit}.`,
      { newExposure, maxExposure, unit },
    );
    this.name = 'MaxTotalExposureExceededError';
  }
}

export class DailyLossLimitExceededError extends PortfolioRiskViolationError {
  constructor(currentDailyLossPct: number, maxDailyLossPct: number) {
    super(
      'DAILY_LOSS_EXCEEDED',
      `Daily simulated loss of ${currentDailyLossPct.toFixed(2)}% has breached maximum configured daily loss limit of ${maxDailyLossPct.toFixed(2)}%. Trading paused.`,
      { currentDailyLossPct, maxDailyLossPct },
    );
    this.name = 'DailyLossLimitExceededError';
  }
}

export class DrawdownLimitExceededError extends PortfolioRiskViolationError {
  constructor(currentDrawdownPct: number, maxDrawdownPct: number) {
    super(
      'DRAWDOWN_EXCEEDED',
      `Portfolio drawdown of ${currentDrawdownPct.toFixed(2)}% has breached maximum configured drawdown limit of ${maxDrawdownPct.toFixed(2)}%. Trading paused.`,
      { currentDrawdownPct, maxDrawdownPct },
    );
    this.name = 'DrawdownLimitExceededError';
  }
}

export class ExitPendingError extends Error {
  public readonly exitPending: ExitPendingDetails;

  constructor(exitPending: ExitPendingDetails) {
    super(
      `[ExitPending] Emergency exit could not be executed realistically for token ${exitPending.tokenMint}: ${exitPending.failureReason}. Position marked EXIT_PENDING.`,
    );
    this.name = 'ExitPendingError';
    this.exitPending = exitPending;
  }
}
