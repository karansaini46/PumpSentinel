import { EventEmitter } from 'node:events';
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
import { SolanaWsConnection } from '../transport/ws-connection.js';
import { SolanaRpcClient } from '../transport/rpc-client.js';
import { EventDeduplicator } from '../transport/deduplicator.js';
import { pumpFunDecoder } from '../decoder/pump-fun-decoder.js';
import { PUMP_FUN_PROGRAM_ID } from '../decoder/pump-fun-layout.js';
import { logger } from '../../observability/logger.js';

export interface HeliusProviderConfig {
  httpUrl: string;
  wsUrl: string;
  apiKey?: string;
  programId?: string;
  maxRequestsPerSecond?: number;
  timeoutMs?: number;
  maxRetries?: number;
  dedupSize?: number;
  dedupTtlMs?: number;
}

export class HeliusSolanaProvider implements ISolanaDataProvider {
  public readonly name = 'HeliusSolanaProvider';
  public readonly source: EventSource = 'helius_ws';

  private emitter = new EventEmitter();
  private wsConnection: SolanaWsConnection;
  private rpcClient: SolanaRpcClient;
  private deduplicator: EventDeduplicator;
  private readonly programId: string;

  private eventsProcessed = 0;
  private lastEventAt: Date | null = null;
  private status: ProviderStatus = 'IDLE';

  constructor(config: HeliusProviderConfig) {
    this.programId = config.programId ?? PUMP_FUN_PROGRAM_ID;

    this.rpcClient = new SolanaRpcClient({
      httpUrl: config.httpUrl,
      apiKey: config.apiKey,
      maxRequestsPerSecond: config.maxRequestsPerSecond ?? 10,
      timeoutMs: config.timeoutMs ?? 10000,
      maxRetries: config.maxRetries ?? 3,
    });

    this.wsConnection = new SolanaWsConnection({
      wsUrl: config.wsUrl,
      apiKey: config.apiKey,
    });

    this.deduplicator = new EventDeduplicator({
      maxSize: config.dedupSize ?? 5000,
      ttlMs: config.dedupTtlMs ?? 300000,
    });

    this.setupListeners();
  }

  private setupListeners(): void {
    this.wsConnection.on('statusChange', (wsStatus) => {
      this.status =
        wsStatus === 'CONNECTED'
          ? 'CONNECTED'
          : wsStatus === 'RECONNECTING'
            ? 'RECONNECTING'
            : 'DISCONNECTED';
      logger.info({ status: this.status }, '[HeliusProvider] Connection status changed');
      this.emitter.emit('statusChange', this.status);
    });

    this.wsConnection.on(
      'logs',
      (value: { signature: string; err: unknown; logs: string[] }, slot: number) => {
        this.handleLogsNotification(value, slot);
      },
    );
  }

  private async handleLogsNotification(
    value: { signature: string; err: unknown; logs: string[] },
    slot: number,
  ): Promise<void> {
    // If the transaction failed on-chain, skip it
    if (value.err) return;

    const signature = value.signature;
    const isNew = this.deduplicator.testAndAdd(signature);
    if (!isNew) {
      logger.debug({ signature }, '[HeliusProvider] Duplicate signature skipped');
      return;
    }

    const parsedEvents = pumpFunDecoder.parseLogs(value.logs);

    for (const parsed of parsedEvents) {
      this.eventsProcessed += 1;
      this.lastEventAt = new Date();

      if (parsed.type === 'CREATE') {
        const ev = parsed.event;
        const createEvent: IngestionTokenCreatedEvent = {
          type: 'TOKEN_CREATED',
          signature,
          slot,
          timestamp: Date.now(),
          receivedAt: new Date(),
          source: this.source,
          mint: ev.mint,
          creator: ev.user,
          name: ev.name,
          symbol: ev.symbol,
          uri: ev.uri,
          bondingCurve: ev.bondingCurve,
          initialSolLiquidity: 30.0, // Standard pump.fun initial virtual bonding curve liquidity
        };

        logger.info(
          { mint: createEvent.mint, symbol: createEvent.symbol, signature },
          '[HeliusProvider] Decoded pump.fun CreateEvent',
        );
        this.emitter.emit('tokenCreated', createEvent);
      } else if (parsed.type === 'TRADE') {
        const tr = parsed.event;
        const tradeEvent: IngestionTradeEvent = {
          type: 'TRADE',
          signature,
          slot,
          timestamp: Number(tr.timestamp ?? BigInt(Date.now())),
          receivedAt: new Date(),
          source: this.source,
          mint: tr.mint,
          user: tr.user,
          isBuy: tr.isBuy,
          solAmount: Number(tr.solAmount) / 1e9,
          tokenAmount: Number(tr.tokenAmount) / 1e6,
          virtualSolReserves: tr.virtualSolReserves
            ? Number(tr.virtualSolReserves) / 1e9
            : undefined,
          virtualTokenReserves: tr.virtualTokenReserves
            ? Number(tr.virtualTokenReserves) / 1e6
            : undefined,
          realSolReserves: tr.realSolReserves ? Number(tr.realSolReserves) / 1e9 : undefined,
          realTokenReserves: tr.realTokenReserves ? Number(tr.realTokenReserves) / 1e6 : undefined,
        };

        logger.debug(
          { mint: tradeEvent.mint, isBuy: tradeEvent.isBuy, sol: tradeEvent.solAmount },
          '[HeliusProvider] Decoded pump.fun TradeEvent',
        );
        this.emitter.emit('trade', tradeEvent);
      }
    }
  }

  public getStatus(): ProviderStatus {
    return this.status;
  }

  public async start(): Promise<void> {
    this.status = 'CONNECTING';
    logger.info({ endpoint: this.wsConnection.sanitizedUrl }, '[HeliusProvider] Starting provider');

    // Subscribe to pump.fun program logs
    this.wsConnection.subscribe('pumpFunLogs', 'logsSubscribe', [
      { mentions: [this.programId] },
      { commitment: 'confirmed' },
    ]);

    try {
      await this.wsConnection.connect();
      this.status = 'CONNECTED';
    } catch (err) {
      this.status = 'ERROR';
      logger.warn(
        { err: (err as Error).message },
        '[HeliusProvider] Initial connection failed, backoff will reconnect',
      );
    }
  }

  public async stop(): Promise<void> {
    await this.wsConnection.disconnect();
    this.status = 'DISCONNECTED';
    logger.info('[HeliusProvider] Provider stopped');
  }

  public async ping(): Promise<number> {
    const start = Date.now();
    await this.rpcClient.getSlot();
    return Date.now() - start;
  }

  public getHealth(): ProviderHealthReport {
    const wsMetrics = this.wsConnection.getMetrics();
    const dedupStats = this.deduplicator.stats;

    return {
      name: this.name,
      source: this.source,
      status: this.status,
      latencyMs: this.rpcClient.getMetrics().lastLatencyMs,
      eventsProcessed: this.eventsProcessed,
      duplicatesPrevented: dedupStats.duplicatesPrevented,
      reconnectCount: wsMetrics.reconnectAttempts,
      lastEventAt: this.lastEventAt,
      sanitizedEndpoint: this.wsConnection.sanitizedUrl,
    };
  }

  public getMetrics(): IngestionMetrics {
    return {
      eventsIngested: this.eventsProcessed,
      duplicatesPrevented: this.deduplicator.stats.duplicatesPrevented,
      lastEventTimestamp: this.lastEventAt?.getTime() ?? null,
      activeSubscriptions: 1,
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

  public onStatusChange(handler: (status: ProviderStatus) => void): () => void {
    this.emitter.on('statusChange', handler);
    return () => {
      this.emitter.off('statusChange', handler);
    };
  }
}
