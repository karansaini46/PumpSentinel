import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type {
  ISolanaDataProvider,
  ProviderStatus,
  ProviderHealthReport,
} from './provider.interface.js';
import type {
  IngestionTokenCreatedEvent,
  IngestionTradeEvent,
  IngestionMetrics,
  EventSource,
} from '../ingestion.types.js';
import { SolanaRpcClient } from '../transport/rpc-client.js';
import { EventDeduplicator } from '../transport/deduplicator.js';
import { pumpFunDecoder } from '../decoder/pump-fun-decoder.js';
import { PUMP_FUN_PROGRAM_ID } from '../decoder/pump-fun-layout.js';
import { logger } from '../../observability/logger.js';

export const ConfirmedSignatureInfoSchema = z.array(
  z.object({
    signature: z.string(),
    slot: z.number(),
    err: z.unknown().nullable(),
    blockTime: z.number().nullable().optional(),
  }),
);

export const EncodedTransactionWithStatusMetaSchema = z.object({
  slot: z.number(),
  blockTime: z.number().nullable().optional(),
  meta: z
    .object({
      err: z.unknown().nullable(),
      logMessages: z.array(z.string()).nullable().optional(),
    })
    .nullable(),
});

export interface PollingProviderConfig {
  httpUrl: string;
  apiKey?: string;
  programId?: string;
  pollingIntervalMs?: number;
  maxRequestsPerSecond?: number;
  batchSize?: number;
}

export class PollingSolanaProvider implements ISolanaDataProvider {
  public readonly name = 'PollingSolanaProvider';
  public readonly source: EventSource = 'solana_rpc_poll';

  private emitter = new EventEmitter();
  private rpcClient: SolanaRpcClient;
  private deduplicator: EventDeduplicator;
  private readonly programId: string;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private status: ProviderStatus = 'IDLE';
  private eventsProcessed = 0;
  private lastEventAt: Date | null = null;

  constructor(config: PollingProviderConfig) {
    this.programId = config.programId ?? PUMP_FUN_PROGRAM_ID;
    this.intervalMs = config.pollingIntervalMs ?? 5000;
    this.batchSize = config.batchSize ?? 10;

    this.rpcClient = new SolanaRpcClient({
      httpUrl: config.httpUrl,
      apiKey: config.apiKey,
      maxRequestsPerSecond: config.maxRequestsPerSecond ?? 10,
    });

    this.deduplicator = new EventDeduplicator();
  }

  public getStatus(): ProviderStatus {
    return this.status;
  }

  public async start(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    this.status = 'CONNECTED';
    logger.info(
      { intervalMs: this.intervalMs, endpoint: this.rpcClient.sanitizedUrl },
      '[PollingProvider] Started polling',
    );
    this.scheduleNextPoll(100);
  }

  public async stop(): Promise<void> {
    this.isPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.status = 'DISCONNECTED';
    logger.info('[PollingProvider] Stopped polling');
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.isPolling) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollOnce();
      } catch (err) {
        logger.warn({ err: (err as Error).message }, '[PollingProvider] Error during poll cycle');
      } finally {
        if (this.isPolling) {
          this.scheduleNextPoll(this.intervalMs);
        }
      }
    }, delayMs);
  }

  public async pollOnce(): Promise<number> {
    const signatures = await this.rpcClient.call(
      'getSignaturesForAddress',
      [this.programId, { limit: this.batchSize, commitment: 'confirmed' }],
      ConfirmedSignatureInfoSchema,
    );

    let newlyDiscovered = 0;

    for (const info of signatures) {
      if (info.err) continue;

      const isNew = this.deduplicator.testAndAdd(info.signature);
      if (!isNew) continue;

      newlyDiscovered += 1;

      try {
        const tx = await this.rpcClient.call(
          'getTransaction',
          [
            info.signature,
            { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
          ],
          EncodedTransactionWithStatusMetaSchema,
        );

        const logs = tx.meta?.logMessages ?? [];
        if (logs.length > 0) {
          const parsedEvents = pumpFunDecoder.parseLogs(logs);

          for (const parsed of parsedEvents) {
            this.eventsProcessed += 1;
            this.lastEventAt = new Date();

            if (parsed.type === 'CREATE') {
              const ev = parsed.event;
              const event: IngestionTokenCreatedEvent = {
                type: 'TOKEN_CREATED',
                signature: info.signature,
                slot: info.slot,
                timestamp: info.blockTime ? info.blockTime * 1000 : Date.now(),
                receivedAt: new Date(),
                source: this.source,
                mint: ev.mint,
                creator: ev.user,
                name: ev.name,
                symbol: ev.symbol,
                uri: ev.uri,
                bondingCurve: ev.bondingCurve,
                initialSolLiquidity: 30.0,
              };
              this.emitter.emit('tokenCreated', event);
            } else if (parsed.type === 'TRADE') {
              const tr = parsed.event;
              const event: IngestionTradeEvent = {
                type: 'TRADE',
                signature: info.signature,
                slot: info.slot,
                timestamp: info.blockTime ? info.blockTime * 1000 : Date.now(),
                receivedAt: new Date(),
                source: this.source,
                mint: tr.mint,
                user: tr.user,
                isBuy: tr.isBuy,
                solAmount: Number(tr.solAmount) / 1e9,
                tokenAmount: Number(tr.tokenAmount) / 1e6,
              };
              this.emitter.emit('trade', event);
            }
          }
        }
      } catch (err) {
        logger.debug(
          { err, signature: info.signature },
          '[PollingProvider] Failed to fetch transaction detail',
        );
      }
    }

    return newlyDiscovered;
  }

  public async ping(): Promise<number> {
    const start = Date.now();
    await this.rpcClient.getSlot();
    return Date.now() - start;
  }

  public getHealth(): ProviderHealthReport {
    return {
      name: this.name,
      source: this.source,
      status: this.status,
      latencyMs: this.rpcClient.getMetrics().lastLatencyMs,
      eventsProcessed: this.eventsProcessed,
      duplicatesPrevented: this.deduplicator.stats.duplicatesPrevented,
      reconnectCount: 0,
      lastEventAt: this.lastEventAt,
      sanitizedEndpoint: this.rpcClient.sanitizedUrl,
    };
  }

  public getMetrics(): IngestionMetrics {
    return {
      eventsIngested: this.eventsProcessed,
      duplicatesPrevented: this.deduplicator.stats.duplicatesPrevented,
      lastEventTimestamp: this.lastEventAt?.getTime() ?? null,
      activeSubscriptions: 0,
      status: this.status,
      source: this.source,
    };
  }

  public onTokenCreated(
    handler: (event: IngestionTokenCreatedEvent) => void | Promise<void>,
  ): () => void {
    this.emitter.on('tokenCreated', handler);
    return () => {
      this.emitter.off('tokenCreated', handler);
    };
  }

  public onTrade(handler: (event: IngestionTradeEvent) => void | Promise<void>): () => void {
    this.emitter.on('trade', handler);
    return () => {
      this.emitter.off('trade', handler);
    };
  }
}
