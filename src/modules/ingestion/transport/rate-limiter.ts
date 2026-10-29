export interface RateLimiterOptions {
  maxRequestsPerSecond: number;
  maxQueueSize?: number;
}

export class RateLimiter {
  private readonly maxTokens: number;
  private tokens: number;
  private readonly refillRatePerMs: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private readonly maxQueueSize: number;

  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.maxRequestsPerSecond;
    this.tokens = options.maxRequestsPerSecond;
    this.refillRatePerMs = options.maxRequestsPerSecond / 1000;
    this.lastRefill = Date.now();
    this.maxQueueSize = options.maxQueueSize ?? 100;
  }

  public async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(
        `[RateLimiter] Request queue full (${this.queue.length}/${this.maxQueueSize}). Throttling exceeded.`,
      );
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleNextRefill();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }

  private scheduleNextRefill(): void {
    const waitTimeMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
    setTimeout(
      () => {
        this.refill();
        while (this.tokens >= 1 && this.queue.length > 0) {
          this.tokens -= 1;
          const resolve = this.queue.shift();
          if (resolve) resolve();
        }
        if (this.queue.length > 0) {
          this.scheduleNextRefill();
        }
      },
      Math.max(10, waitTimeMs),
    );
  }
}
