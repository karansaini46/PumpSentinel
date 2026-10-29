export type IngestionEventType = 'TOKEN_CREATED' | 'TRADE' | 'LIQUIDITY_MIGRATED';

export type EventSource = 'helius_ws' | 'solana_rpc_ws' | 'solana_rpc_poll' | 'mock';

export interface BaseIngestionEvent {
  type: IngestionEventType;
  signature: string;
  slot: number;
  timestamp: number;
  receivedAt: Date;
  source: EventSource;
  blockTime?: number | null;
}

export interface IngestionTokenCreatedEvent extends BaseIngestionEvent {
  type: 'TOKEN_CREATED';
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  bondingCurve?: string;
  initialSolLiquidity: number;
}

export interface IngestionTradeEvent extends BaseIngestionEvent {
  type: 'TRADE';
  mint: string;
  user: string;
  isBuy: boolean;
  solAmount: number;
  tokenAmount: number;
  virtualSolReserves?: number;
  virtualTokenReserves?: number;
  realSolReserves?: number;
  realTokenReserves?: number;
}

export interface IngestionLiquidityMigratedEvent extends BaseIngestionEvent {
  type: 'LIQUIDITY_MIGRATED';
  mint: string;
  raydiumPoolAddress?: string;
}

export type IngestionEvent =
  IngestionTokenCreatedEvent | IngestionTradeEvent | IngestionLiquidityMigratedEvent;

export interface IngestionMetrics {
  eventsIngested: number;
  duplicatesPrevented: number;
  lastEventTimestamp: number | null;
  activeSubscriptions: number;
  status: 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'ERROR';
  source: EventSource;
}
