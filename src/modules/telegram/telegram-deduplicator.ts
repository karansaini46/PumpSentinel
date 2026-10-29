/**
 * Telegram Command Deduplicator: Prevents duplicate command execution
 * caused by Telegram API retries or duplicate webhook delivery.
 */
export class TelegramDeduplicator {
  private cache = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs = 300000, maxSize = 5000) {
    this.ttlMs = ttlMs; // 5 minutes default TTL
    this.maxSize = maxSize; // Tuned for low memory
  }

  /**
   * Checks if an update or message has already been processed.
   * If not, marks it as processed atomically and returns false.
   * If already processed within TTL, returns true.
   */
  public isDuplicate(key: string | number, nowMs: number = Date.now()): boolean {
    const strKey = String(key);
    const existing = this.cache.get(strKey);

    if (existing !== undefined && nowMs - existing < this.ttlMs) {
      return true;
    }

    return false;
  }

  public markProcessed(key: string | number, nowMs: number = Date.now()): void {
    const strKey = String(key);
    this.cache.set(strKey, nowMs);

    // Evict oldest entries if capacity exceeded
    if (this.cache.size > this.maxSize) {
      this.evictStale(nowMs);
    }
  }

  /**
   * Atomically checks if key is duplicate. If duplicate, returns true.
   * If not duplicate, marks it and returns false.
   */
  public checkAndMark(key: string | number, nowMs: number = Date.now()): boolean {
    if (this.isDuplicate(key, nowMs)) {
      return true;
    }
    this.markProcessed(key, nowMs);
    return false;
  }

  private evictStale(nowMs: number): void {
    const threshold = nowMs - this.ttlMs;
    for (const [k, timestamp] of this.cache.entries()) {
      if (timestamp < threshold) {
        this.cache.delete(k);
      }
    }

    // If still over maxSize after TTL eviction, delete oldest 20%
    if (this.cache.size > this.maxSize) {
      const keysToDelete = Array.from(this.cache.keys()).slice(0, Math.floor(this.maxSize * 0.2));
      for (const k of keysToDelete) {
        this.cache.delete(k);
      }
    }
  }

  public reset(): void {
    this.cache.clear();
  }
}

export const telegramDeduplicator = new TelegramDeduplicator();
