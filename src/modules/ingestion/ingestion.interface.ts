import type { IngestionEvent, IngestionMetrics } from './ingestion.types.js';

export type IngestionEventHandler = (event: IngestionEvent) => void | Promise<void>;

export interface IIngestionService {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: IngestionEventHandler): () => void;
  getMetrics(): IngestionMetrics;
}
