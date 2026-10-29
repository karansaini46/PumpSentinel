export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type NotificationCategory =
  | 'TOKEN_ALERT'
  | 'TOKEN_DISCOVERY'
  | 'TRADE_SIMULATION'
  | 'RISK_ALERT'
  | 'SYSTEM_ALERT'
  | 'SYSTEM_HEALTH'
  | 'PORTFOLIO_RISK';

export type AlertEventType =
  | 'TOKEN_DISCOVERED'
  | 'RISK_REJECTED'
  | 'STRATEGY_ELIGIBLE'
  | 'SIMULATED_BUY'
  | 'SIMULATED_SELL'
  | 'STOP_LOSS_TRIGGERED'
  | 'TAKE_PROFIT_TRIGGERED'
  | 'EMERGENCY_EXIT'
  | 'DAILY_LOSS_LIMIT'
  | 'PROVIDER_OUTAGE'
  | 'STALE_MARKET_DATA'
  | 'RECONCILIATION_ERROR';

/**
 * Payload for token discovery, risk rejection, and strategy eligibility alerts.
 */
export interface TokenAlertPayload {
  mint: string;
  symbol: string;
  name?: string;
  discoveryTimestamp: Date | number;
  creator?: string;
  liquiditySol: number;
  dataFreshnessMs?: number;
  riskScore?: number;
  riskSummary?: string;
  decision: 'DISCOVERED' | 'ELIGIBLE_FOR_STRATEGY' | 'REJECT' | 'NEEDS_RECHECK';
  decisionReason: string;
  marketDataSource: string;
  isSynthetic?: boolean;
  slot?: number;
}

/**
 * Payload for simulated paper trades (buys, sells, stop-loss, take-profit, emergency exits).
 */
export interface SimulatedTradeAlertPayload {
  tradeId?: string;
  tokenMint: string;
  tokenSymbol: string;
  side: 'BUY' | 'SELL';
  /**
   * Distinguish between requested vs confirmed filled orders.
   * Requirement 1: Never claim an order filled when it was only requested.
   */
  stage: 'REQUESTED' | 'FILLED' | 'REJECTED';
  entryPriceSol?: number;
  entryPriceUsd?: number;
  exitPriceSol?: number;
  exitPriceUsd?: number;
  executedPriceSol: number;
  executedPriceUsd?: number;
  amountTokens: number;
  totalSol: number;
  totalUsd?: number;
  simulatedFeeSol: number;
  slippageBps: number;
  realizedPnlSol?: number;
  realizedPnlPct?: number;
  unrealizedPnlSol?: number;
  unrealizedPnlPct?: number;
  exitReason?: string;
  executedAt: Date;
}

/**
 * Payload for operational system alerts (provider outage, stale data, reconciliation, daily loss limit).
 */
export interface SystemAlertPayload {
  type:
    | 'PROVIDER_OUTAGE'
    | 'STALE_MARKET_DATA'
    | 'RECONCILIATION_ERROR'
    | 'DAILY_LOSS_LIMIT'
    | 'EMERGENCY_EXIT';
  title: string;
  details: string;
  subsystem: string;
  error?: string;
  metrics?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Configuration for quiet periods for noncritical messages.
 */
export interface QuietHoursConfig {
  enabled: boolean;
  startHourUtc: number; // 0-23
  endHourUtc: number; // 0-23
  allowCritical: boolean; // Always true
  allowHigh: boolean; // Default true
}

/**
 * Configuration for notification queue, retries, rate limits, and batching.
 */
export interface NotificationQueueConfig {
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  rateLimitMinIntervalMs: number;
  globalRateLimitPerSec: number;
  batchIntervalMs: number;
  batchMaxItems: number;
  dedupeTtlMs: number;
  quietHours: QuietHoursConfig;
}

export interface SentinelNotification {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface INotificationChannel {
  send(notification: SentinelNotification): Promise<void>;
}
