import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { logger } from '../../observability/logger.js';

export type WsConnectionStatus =
  'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'FAILED';

export const LogsNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('logsNotification'),
  params: z.object({
    subscription: z.number(),
    result: z.object({
      context: z.object({
        slot: z.number(),
      }),
      value: z.object({
        signature: z.string(),
        err: z.unknown().nullable(),
        logs: z.array(z.string()),
      }),
    }),
  }),
});

export type LogsNotification = z.infer<typeof LogsNotificationSchema>;

export interface WsConnectionOptions {
  wsUrl: string;
  apiKey?: string;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  maxReconnectDelayMs?: number;
}

export interface WsMetrics {
  status: WsConnectionStatus;
  reconnectAttempts: number;
  messagesReceived: number;
  lastMessageTimestamp: number | null;
  lastPongTimestamp: number | null;
}

export class SolanaWsConnection extends EventEmitter {
  private readonly rawUrl: string;
  private ws: WebSocket | null = null;
  private status: WsConnectionStatus = 'DISCONNECTED';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private isIntentionallyClosed = false;

  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly maxReconnectDelayMs: number;
  private messagesReceived = 0;
  private lastMessageTimestamp: number | null = null;
  private lastPongTimestamp: number | null = null;

  // Active subscriptions to re-register upon reconnection
  private activeSubscriptions = new Map<string, { method: string; params: unknown[] }>();

  constructor(options: WsConnectionOptions) {
    super();
    this.rawUrl = this.buildUrl(options.wsUrl, options.apiKey);
    this.pingIntervalMs = options.pingIntervalMs ?? 20000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 10000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
  }

  private buildUrl(baseUrl: string, apiKey?: string): string {
    if (!apiKey) return baseUrl;
    const url = new URL(baseUrl);
    if (!url.searchParams.has('api-key')) {
      url.searchParams.set('api-key', apiKey);
    }
    return url.toString();
  }

  public get sanitizedUrl(): string {
    try {
      const url = new URL(this.rawUrl);
      if (url.searchParams.has('api-key')) {
        url.searchParams.set('api-key', '[REDACTED]');
      }
      return decodeURIComponent(url.toString());
    } catch {
      return '[INVALID_URL]';
    }
  }

  public connect(): Promise<void> {
    this.isIntentionallyClosed = false;
    return new Promise((resolve, reject) => {
      this.setStatus('CONNECTING');
      logger.info({ url: this.sanitizedUrl }, '[SolanaWs] Connecting to WebSocket');

      try {
        this.ws = new WebSocket(this.rawUrl);

        const onOpen = () => {
          this.setStatus('CONNECTED');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.resubscribeAll();
          logger.info('[SolanaWs] WebSocket connected successfully');
          cleanup();
          resolve();
        };

        const onError = (err: Error) => {
          logger.error({ err: err.message, url: this.sanitizedUrl }, '[SolanaWs] WebSocket error');
          cleanup();
          if (this.status === 'CONNECTING') {
            this.handleDisconnect();
            reject(err);
          }
        };

        const cleanup = () => {
          this.ws?.off('open', onOpen);
          this.ws?.off('error', onError);
        };

        this.ws.once('open', onOpen);
        this.ws.once('error', onError);

        this.setupEventListeners();
      } catch (err) {
        this.setStatus('FAILED');
        reject(err);
      }
    });
  }

  private setupEventListeners(): void {
    if (!this.ws) return;

    this.ws.on('message', (data: Buffer | string) => {
      this.messagesReceived += 1;
      this.lastMessageTimestamp = Date.now();
      this.handleIncomingMessage(data.toString());
    });

    this.ws.on('pong', () => {
      this.lastPongTimestamp = Date.now();
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(
        { code, reason: reason.toString(), sanitizedUrl: this.sanitizedUrl },
        '[SolanaWs] WebSocket closed',
      );
      this.handleDisconnect();
    });

    this.ws.on('error', (err) => {
      logger.error({ err: err.message }, '[SolanaWs] Socket runtime error');
    });
  }

  private handleIncomingMessage(raw: string): void {
    try {
      const parsed: unknown = JSON.parse(raw);

      // Validate if it is a logsNotification
      const validated = LogsNotificationSchema.safeParse(parsed);
      if (validated.success) {
        this.emit(
          'logs',
          validated.data.params.result.value,
          validated.data.params.result.context.slot,
        );
        return;
      }

      // Check for subscription confirmation
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'result' in parsed &&
        typeof (parsed as { result: unknown }).result === 'number'
      ) {
        logger.debug(
          { subId: (parsed as { result: number }).result },
          '[SolanaWs] Subscription confirmed',
        );
        return;
      }

      this.emit('message', parsed);
    } catch (err) {
      logger.debug(
        { err, rawSnippet: raw.slice(0, 100) },
        '[SolanaWs] Could not parse message as JSON',
      );
    }
  }

  private handleDisconnect(): void {
    this.stopHeartbeat();

    if (this.isIntentionallyClosed) {
      this.setStatus('DISCONNECTED');
      return;
    }

    this.setStatus('RECONNECTING');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    // Exponential backoff + jitter: min(30s, 2^n * 500ms + jitter)
    const baseDelay = Math.min(this.maxReconnectDelayMs, Math.pow(2, this.reconnectAttempts) * 500);
    const delayMs = baseDelay + Math.floor(Math.random() * 500);

    logger.info(
      { attempt: this.reconnectAttempts, delayMs },
      '[SolanaWs] Scheduling WebSocket reconnection',
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        logger.warn('[SolanaWs] Reconnection attempt failed. Will retry.');
      }
    }, delayMs);
  }

  public subscribe(key: string, method: string, params: unknown[]): void {
    this.activeSubscriptions.set(key, { method, params });
    if (this.status === 'CONNECTED' && this.ws?.readyState === WebSocket.OPEN) {
      this.sendRpc(method, params);
    }
  }

  private resubscribeAll(): void {
    for (const [key, sub] of this.activeSubscriptions.entries()) {
      logger.debug({ key, method: sub.method }, '[SolanaWs] Resubscribing');
      this.sendRpc(sub.method, sub.params);
    }
  }

  public sendRpc(method: string, params: unknown[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ method }, '[SolanaWs] Cannot send RPC: WebSocket not OPEN');
      return;
    }

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1000000),
      method,
      params,
    });

    this.ws.send(payload);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.pongTimeout = setTimeout(() => {
          logger.warn('[SolanaWs] Ping timed out. Forcing reconnection.');
          this.ws?.terminate();
        }, this.pongTimeoutMs);
      }
    }, this.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private setStatus(status: WsConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('statusChange', status);
    }
  }

  public async disconnect(): Promise<void> {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('DISCONNECTED');
  }

  public getMetrics(): WsMetrics {
    return {
      status: this.status,
      reconnectAttempts: this.reconnectAttempts,
      messagesReceived: this.messagesReceived,
      lastMessageTimestamp: this.lastMessageTimestamp,
      lastPongTimestamp: this.lastPongTimestamp,
    };
  }
}
