import { logger } from '../../observability/logger.js';

/**
 * Tracks and enforces per-token RPC request budgets.
 * Prevents runaway RPC consumption for individual tokens.
 */
export class RequestBudget {
  private readonly limit: number;
  private used = 0;

  constructor(limit = 8) {
    this.limit = Math.max(1, limit);
  }

  public getLimit(): number {
    return this.limit;
  }

  public getUsed(): number {
    return this.used;
  }

  public getRemaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  public isExhausted(): boolean {
    return this.used >= this.limit;
  }

  public canConsume(units = 1): boolean {
    return this.used + units <= this.limit;
  }

  public consume(units = 1): boolean {
    if (!this.canConsume(units)) {
      logger.debug(
        { limit: this.limit, used: this.used, requested: units },
        '[RequestBudget] Budget exhausted; call refused',
      );
      return false;
    }
    this.used += units;
    return true;
  }
}

/**
 * Bounded Concurrency Semaphore.
 * Ensures the analysis service never overwhelms host memory or RPC endpoints
 * with too many concurrent token analysis pipelines.
 */
export class BoundedConcurrencyQueue {
  private activeCount = 0;
  private readonly maxConcurrency: number;
  private readonly maxQueueSize: number;
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timeoutId: NodeJS.Timeout;
  }> = [];

  constructor(maxConcurrency = 3, maxQueueSize = 50) {
    this.maxConcurrency = maxConcurrency;
    this.maxQueueSize = maxQueueSize;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public async run<T>(task: () => Promise<T>, timeoutMs = 15000): Promise<T> {
    await this.acquire(timeoutMs);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(timeoutMs: number): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(
        `[BoundedConcurrencyQueue] Queue full (${this.queue.length}/${this.maxQueueSize}). Analysis request rejected.`,
      );
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.queue.findIndex((entry) => entry.resolve === resolve);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(
            new Error(`[BoundedConcurrencyQueue] Analysis queue wait timed out (${timeoutMs}ms)`),
          );
        }
      }, timeoutMs);

      this.queue.push({ resolve, reject, timeoutId });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timeoutId);
        next.resolve();
        return;
      }
    }
    this.activeCount = Math.max(0, this.activeCount - 1);
  }
}
