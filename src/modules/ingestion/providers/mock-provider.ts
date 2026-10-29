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

export class MockSolanaProvider implements ISolanaDataProvider {
  public readonly name = 'MockSolanaProvider';
  public readonly source: EventSource = 'mock';

  private emitter = new EventEmitter();
  private status: ProviderStatus = 'IDLE';
  private eventsProcessed = 0;
  private lastEventAt: Date | null = null;

  public getStatus(): ProviderStatus {
    return this.status;
  }

  public async start(): Promise<void> {
    this.status = 'CONNECTED';
  }

  public async stop(): Promise<void> {
    this.status = 'DISCONNECTED';
  }

  public async ping(): Promise<number> {
    return 1;
  }

  public emitMockCreate(event: Partial<IngestionTokenCreatedEvent>): IngestionTokenCreatedEvent {
    const fullEvent: IngestionTokenCreatedEvent = {
      type: 'TOKEN_CREATED',
      signature: event.signature ?? `mock_sig_${Date.now()}`,
      slot: event.slot ?? 1234567,
      timestamp: event.timestamp ?? Date.now(),
      receivedAt: new Date(),
      source: 'mock',
      mint: event.mint ?? 'MockMint11111111111111111111111111111111111',
      creator: event.creator ?? 'MockDev11111111111111111111111111111111111',
      name: event.name ?? 'Mock Token',
      symbol: event.symbol ?? 'MOCK',
      uri: event.uri ?? 'https://ipfs.io/ipfs/mock',
      initialSolLiquidity: event.initialSolLiquidity ?? 30.0,
    };

    this.eventsProcessed += 1;
    this.lastEventAt = new Date();
    this.emitter.emit('tokenCreated', fullEvent);
    return fullEvent;
  }

  public emitMockTrade(event: Partial<IngestionTradeEvent>): IngestionTradeEvent {
    const fullEvent: IngestionTradeEvent = {
      type: 'TRADE',
      signature: event.signature ?? `mock_trade_sig_${Date.now()}`,
      slot: event.slot ?? 1234568,
      timestamp: event.timestamp ?? Date.now(),
      receivedAt: new Date(),
      source: 'mock',
      mint: event.mint ?? 'MockMint11111111111111111111111111111111111',
      user: event.user ?? 'MockUser1111111111111111111111111111111111',
      isBuy: event.isBuy ?? true,
      solAmount: event.solAmount ?? 1.5,
      tokenAmount: event.tokenAmount ?? 100000,
    };

    this.eventsProcessed += 1;
    this.lastEventAt = new Date();
    this.emitter.emit('trade', fullEvent);
    return fullEvent;
  }

  public getHealth(): ProviderHealthReport {
    return {
      name: this.name,
      source: this.source,
      status: this.status,
      latencyMs: 1,
      eventsProcessed: this.eventsProcessed,
      duplicatesPrevented: 0,
      reconnectCount: 0,
      lastEventAt: this.lastEventAt,
      sanitizedEndpoint: 'mock://local',
    };
  }

  public getMetrics(): IngestionMetrics {
    return {
      eventsIngested: this.eventsProcessed,
      duplicatesPrevented: 0,
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
}
