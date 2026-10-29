import { EventEmitter } from 'node:events';
import type { IIngestionService, IngestionEventHandler } from './ingestion.interface.js';
import type { IngestionEvent, IngestionMetrics } from './ingestion.types.js';
import type { ISolanaDataProvider, ProviderHealthReport } from './providers/provider.interface.js';
import { HeliusSolanaProvider } from './providers/helius-provider.js';
import { configService } from '../configuration/config.service.js';
import { logger } from '../observability/logger.js';

export class IngestionStreamService implements IIngestionService {
  private emitter = new EventEmitter();
  private provider: ISolanaDataProvider | null = null;
  private unsubscribeTokenCreated: (() => void) | null = null;
  private unsubscribeTrade: (() => void) | null = null;
  private isRunning = false;

  constructor(customProvider?: ISolanaDataProvider) {
    this.emitter.on('error', (err) => {
      logger.error({ err }, '[IngestionStreamService] Uncaught stream error');
    });

    if (customProvider) {
      this.setProvider(customProvider);
    }
  }

  public setProvider(provider: ISolanaDataProvider): void {
    if (this.provider) {
      this.unsubscribeTokenCreated?.();
      this.unsubscribeTrade?.();
    }

    this.provider = provider;
    logger.info(
      { provider: provider.name, source: provider.source },
      '[IngestionStreamService] Setting active data provider',
    );

    this.unsubscribeTokenCreated = this.provider.onTokenCreated((event) => {
      this.dispatch(event);
    });

    this.unsubscribeTrade = this.provider.onTrade((event) => {
      this.dispatch(event);
    });
  }

  public getProvider(): ISolanaDataProvider {
    if (!this.provider) {
      const config = configService.getAll();
      const httpUrl = config.HELIUS_RPC_HTTP_URL || config.SOLANA_RPC_HTTP_URL;
      const wsUrl = config.HELIUS_RPC_WS_URL || config.SOLANA_RPC_WS_URL;

      const helius = new HeliusSolanaProvider({
        httpUrl,
        wsUrl,
        apiKey: config.HELIUS_API_KEY,
        programId: config.PUMP_FUN_PROGRAM_ID,
        maxRequestsPerSecond: config.RPC_MAX_REQUESTS_PER_SECOND,
        timeoutMs: config.RPC_TIMEOUT_MS,
        maxRetries: config.RPC_MAX_RETRIES,
        dedupSize: config.DEDUPLICATION_CACHE_SIZE,
        dedupTtlMs: config.DEDUPLICATION_TTL_MS,
      });

      this.setProvider(helius);
    }

    return this.provider as ISolanaDataProvider;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const provider = this.getProvider();
    await provider.start();
    logger.info(
      { provider: provider.name },
      '[IngestionStreamService] Ingestion stream started with active provider',
    );
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.provider) {
      await this.provider.stop();
    }
    logger.info('[IngestionStreamService] Ingestion stream stopped');
  }

  public onEvent(handler: IngestionEventHandler): () => void {
    const wrappedHandler = async (event: IngestionEvent) => {
      try {
        await handler(event);
      } catch (err) {
        logger.error(
          { err, eventType: event.type },
          '[IngestionStreamService] Error in event handler',
        );
      }
    };

    this.emitter.on('event', wrappedHandler);
    return () => {
      this.emitter.off('event', wrappedHandler);
    };
  }

  public dispatch(event: IngestionEvent): void {
    this.emitter.emit('event', event);
  }

  public getMetrics(): IngestionMetrics {
    if (this.provider) {
      return this.provider.getMetrics();
    }

    return {
      eventsIngested: 0,
      duplicatesPrevented: 0,
      lastEventTimestamp: null,
      activeSubscriptions: 0,
      status: this.isRunning ? 'CONNECTED' : 'IDLE',
      source: 'mock',
    };
  }

  public getHealth(): ProviderHealthReport {
    if (this.provider) {
      return this.provider.getHealth();
    }

    return {
      name: 'None',
      source: 'mock',
      status: 'IDLE',
      latencyMs: 0,
      eventsProcessed: 0,
      duplicatesPrevented: 0,
      reconnectCount: 0,
      lastEventAt: null,
      sanitizedEndpoint: 'none',
    };
  }
}

export const ingestionStreamService = new IngestionStreamService();
