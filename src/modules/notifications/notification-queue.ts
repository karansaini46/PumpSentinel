import { EventEmitter } from 'node:events';
import type {
  SentinelNotification,
  NotificationQueueConfig,
  TokenAlertPayload,
  NotificationPriority,
} from './notifications.types.js';
import { formatTokenBatch } from './notification-formatter.js';
import { logger } from '../observability/logger.js';

export type DispatchHandler = (notification: SentinelNotification) => Promise<void>;

export const DEFAULT_NOTIFICATION_QUEUE_CONFIG: NotificationQueueConfig = {
  maxRetries: 3,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 10000,
  rateLimitMinIntervalMs: 1000, // Min 1s per recipient
  globalRateLimitPerSec: 25, // Telegram allows max 30/sec
  batchIntervalMs: 30000, // 30s batch window
  batchMaxItems: 5, // 5 tokens per batch
  dedupeTtlMs: 300000, // 5 minutes TTL
  quietHours: {
    enabled: false,
    startHourUtc: 22, // 22:00 UTC
    endHourUtc: 7, // 07:00 UTC
    allowCritical: true, // Critical alerts ALWAYS bypass quiet hours
    allowHigh: true,
  },
};

export class NotificationQueue {
  private config: NotificationQueueConfig;
  private dispatchHandler: DispatchHandler | null = null;
  private dedupeCache = new Map<string, number>();
  private batchBuffer: TokenAlertPayload[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private queue: Array<{
    notification: SentinelNotification;
    attempt: number;
    enqueuedAt: number;
  }> = [];
  private lastGlobalSendMs = 0;
  private lastUserSendMs = new Map<number, number>();
  private emitter = new EventEmitter();

  constructor(customConfig?: Partial<NotificationQueueConfig>) {
    this.config = {
      ...DEFAULT_NOTIFICATION_QUEUE_CONFIG,
      ...customConfig,
      quietHours: {
        ...DEFAULT_NOTIFICATION_QUEUE_CONFIG.quietHours,
        ...customConfig?.quietHours,
      },
    };
  }

  public setHandler(handler: DispatchHandler): void {
    this.dispatchHandler = handler;
  }

  public getConfig(): Readonly<NotificationQueueConfig> {
    return Object.freeze({ ...this.config });
  }

  public updateConfig(newConfig: Partial<NotificationQueueConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      quietHours: {
        ...this.config.quietHours,
        ...newConfig.quietHours,
      },
    };
  }

  /**
   * Start batch timer and background processing.
   */
  public start(): void {
    if (this.batchTimer) return;
    this.batchTimer = setInterval(() => {
      this.flushBatch();
    }, this.config.batchIntervalMs);
  }

  /**
   * Stop batch timer and drain remaining queue.
   */
  public stop(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    this.flushBatch();
  }

  /**
   * Evaluates if the current UTC time falls within the configured quiet period.
   * Requirement 8: Configurable quiet periods for noncritical messages.
   */
  public isQuietHours(now = new Date()): boolean {
    if (!this.config.quietHours.enabled) return false;

    const currentHour = now.getUTCHours();
    const { startHourUtc, endHourUtc } = this.config.quietHours;

    if (startHourUtc < endHourUtc) {
      // Intra-day range, e.g. 13:00 to 16:00
      return currentHour >= startHourUtc && currentHour < endHourUtc;
    } else {
      // Range spans midnight, e.g. 22:00 to 07:00
      return currentHour >= startHourUtc || currentHour < endHourUtc;
    }
  }

  /**
   * Checks if a notification should be suppressed by quiet hours.
   * Invariant: CRITICAL system failures are NEVER suppressed.
   */
  public shouldSuppressForQuietHours(priority: NotificationPriority, now = new Date()): boolean {
    if (!this.isQuietHours(now)) return false;

    // Requirement 7: Send immediate alerts for critical system failures
    if (priority === 'CRITICAL') return false;

    if (priority === 'HIGH' && this.config.quietHours.allowHigh) {
      return false;
    }

    return true; // Suppress MEDIUM and LOW in quiet hours
  }

  /**
   * Deduplication check using in-memory TTL cache.
   * Requirement 3: Deduplicate notifications.
   */
  public isDuplicate(key: string, nowMs = Date.now()): boolean {
    const existing = this.dedupeCache.get(key);
    if (existing !== undefined && nowMs - existing < this.config.dedupeTtlMs) {
      return true;
    }
    return false;
  }

  public markDedupe(key: string, nowMs = Date.now()): void {
    this.dedupeCache.set(key, nowMs);

    // Bounded cleanup when cache exceeds 2000 entries
    if (this.dedupeCache.size > 2000) {
      const threshold = nowMs - this.config.dedupeTtlMs;
      for (const [k, ts] of this.dedupeCache.entries()) {
        if (ts < threshold) {
          this.dedupeCache.delete(k);
        }
      }
    }
  }

  /**
   * Buffer a low-priority token discovery alert for batching.
   * Requirement 6: Batch low-priority alerts.
   */
  public enqueueBatchToken(token: TokenAlertPayload): void {
    const dedupeKey = `token:${token.mint}:DISCOVERED`;
    if (this.isDuplicate(dedupeKey)) {
      logger.debug({ mint: token.mint }, '[NotificationQueue] Dropping duplicate token discovery');
      return;
    }
    this.markDedupe(dedupeKey);

    this.batchBuffer.push(token);

    if (this.batchBuffer.length >= this.config.batchMaxItems) {
      this.flushBatch();
    }
  }

  /**
   * Flushes batched low-priority discovery alerts into a consolidated notification.
   */
  public flushBatch(): void {
    if (this.batchBuffer.length === 0) return;

    const tokensToFlush = [...this.batchBuffer];
    this.batchBuffer = [];

    const formatted = formatTokenBatch(tokensToFlush);
    const notification: SentinelNotification = {
      id: `batch_${Date.now()}`,
      category: formatted.category,
      priority: formatted.priority,
      title: formatted.title,
      message: formatted.html,
      timestamp: new Date(),
      dedupeKey: formatted.dedupeKey,
    };

    void this.enqueue(notification);
  }

  private static readonly PRIORITY_WEIGHTS: Record<NotificationPriority, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  private insertByPriority(item: {
    notification: SentinelNotification;
    attempt: number;
    enqueuedAt: number;
  }): void {
    const itemWeight = NotificationQueue.PRIORITY_WEIGHTS[item.notification.priority] ?? 2;
    const index = this.queue.findIndex(
      (existing) =>
        (NotificationQueue.PRIORITY_WEIGHTS[existing.notification.priority] ?? 2) > itemWeight,
    );
    if (index === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(index, 0, item);
    }
  }

  /**
   * Enqueues an alert for dispatch.
   * - Critical system failures bypass queue and dispatch immediately.
   * - Deduplicates against recent messages.
   * - Suppresses noncritical messages during quiet hours.
   */
  public async enqueue(notification: SentinelNotification): Promise<boolean> {
    const now = new Date();
    const nowMs = now.getTime();

    // 1. Deduplication check
    if (notification.dedupeKey) {
      if (this.isDuplicate(notification.dedupeKey, nowMs)) {
        logger.debug(
          { dedupeKey: notification.dedupeKey, title: notification.title },
          '[NotificationQueue] Dropping duplicate alert notification',
        );
        return false;
      }
      this.markDedupe(notification.dedupeKey, nowMs);
    }

    // 2. Quiet Hours check
    if (this.shouldSuppressForQuietHours(notification.priority, now)) {
      logger.info(
        { title: notification.title, priority: notification.priority },
        '[NotificationQueue] Notification suppressed due to active quiet hours',
      );
      return false;
    }

    // 3. Priority insertion (Requirement 7: Send immediate alerts for critical system failures)
    const item = {
      notification,
      attempt: 0,
      enqueuedAt: nowMs,
    };

    if (notification.priority === 'CRITICAL') {
      logger.warn(
        { title: notification.title, priority: notification.priority },
        '[NotificationQueue] CRITICAL SYSTEM ALERT — High-priority queue insertion',
      );
    }

    this.insertByPriority(item);
    void this.processQueue();
    return true;
  }

  /**
   * Processes the queue sequentially, enforcing Telegram rate limits and retries with bounded backoff.
   * Requirements 4 & 5.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;

        // Rate Limit Delay: Ensure minimum gap between global messages (Telegram <= 30/s)
        const nowMs = Date.now();
        const minGlobalGapMs = Math.ceil(1000 / this.config.globalRateLimitPerSec);
        const elapsedSinceLastSend = nowMs - this.lastGlobalSendMs;

        if (elapsedSinceLastSend < minGlobalGapMs) {
          await this.delay(minGlobalGapMs - elapsedSinceLastSend);
        }

        if (!this.dispatchHandler) {
          logger.warn('[NotificationQueue] No dispatch handler registered. Dropping alert.');
          continue;
        }

        try {
          await this.dispatchHandler(item.notification);
          this.lastGlobalSendMs = Date.now();
          this.emitter.emit('sent', item.notification);
        } catch (err: unknown) {
          item.attempt += 1;

          if (item.attempt >= this.config.maxRetries) {
            logger.error(
              {
                err,
                title: item.notification.title,
                attempts: item.attempt,
              },
              '[NotificationQueue] Max retries exhausted for notification. Dropping alert.',
            );
            this.emitter.emit('failed', { notification: item.notification, error: err });
            continue;
          }

          // Requirement 4: Retries with bounded backoff
          const retryAfterMs = this.calculateBackoffDelay(err, item.attempt);
          logger.warn(
            {
              title: item.notification.title,
              attempt: item.attempt,
              retryAfterMs,
            },
            '[NotificationQueue] Notification dispatch failed. Scheduling retry with backoff.',
          );

          this.insertByPriority(item);
          await this.delay(retryAfterMs);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Calculates backoff delay, honoring Telegram retry_after parameter if present,
   * or using bounded exponential backoff with jitter.
   */
  public calculateBackoffDelay(err: unknown, attempt: number): number {
    // Check for Telegram 429 retry_after
    if (err && typeof err === 'object') {
      const errObj = err as Record<string, unknown>;
      const parameters = errObj['parameters'] as Record<string, unknown> | undefined;
      const retryAfterSec =
        (parameters?.['retry_after'] as number | undefined) ??
        (errObj['retry_after'] as number | undefined);

      if (typeof retryAfterSec === 'number' && retryAfterSec > 0) {
        const jitter = Math.floor(Math.random() * 20);
        return Math.round(retryAfterSec * 1000) + jitter;
      }
    }

    // Exponential backoff: baseDelay * 2^(attempt - 1) + jitter, bounded by maxRetryDelayMs
    const exp = Math.min(
      this.config.maxRetryDelayMs,
      this.config.baseRetryDelayMs * Math.pow(2, attempt - 1),
    );
    const jitter = Math.floor(Math.random() * 200);
    return Math.min(this.config.maxRetryDelayMs, exp + jitter);
  }

  public getPendingCount(): number {
    return this.queue.length;
  }

  public getBatchBufferSize(): number {
    return this.batchBuffer.length;
  }

  public clear(): void {
    this.queue = [];
    this.batchBuffer = [];
    this.dedupeCache.clear();
    this.lastUserSendMs.clear();
    this.lastGlobalSendMs = 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const notificationQueue = new NotificationQueue();
