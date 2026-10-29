import type {
  IngestionTokenCreatedEvent,
  IngestionTradeEvent,
  IngestionMetrics,
  EventSource,
} from '../ingestion.types.js';

export type ProviderStatus =
  'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'ERROR';

export interface ProviderHealthReport {
  name: string;
  source: EventSource;
  status: ProviderStatus;
  latencyMs: number;
  eventsProcessed: number;
  duplicatesPrevented: number;
  reconnectCount: number;
  lastEventAt: Date | null;
  sanitizedEndpoint: string;
}

export interface ISolanaDataProvider {
  readonly name: string;
  readonly source: EventSource;
  getStatus(): ProviderStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  ping(): Promise<number>;
  getHealth(): ProviderHealthReport;
  getMetrics(): IngestionMetrics;

  onTokenCreated(handler: (event: IngestionTokenCreatedEvent) => void | Promise<void>): () => void;
  onTrade(handler: (event: IngestionTradeEvent) => void | Promise<void>): () => void;
  onStatusChange?(handler: (status: ProviderStatus) => void): () => void;
}
