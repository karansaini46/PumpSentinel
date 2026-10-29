export interface DeduplicatorOptions {
  maxSize?: number;
  ttlMs?: number;
}

interface CacheEntry {
  addedAt: number;
}

export class EventDeduplicator {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private duplicateCount = 0;

  constructor(options: DeduplicatorOptions = {}) {
    this.maxSize = options.maxSize ?? 5000;
    this.ttlMs = options.ttlMs ?? 300000; // 5 minutes default
  }

  /**
   * Check if an event ID is already processed.
   * If not, records it and returns true. If duplicate, returns false.
   */
  public testAndAdd(id: string): boolean {
    const now = Date.now();
    const existing = this.cache.get(id);

    if (existing) {
      if (now - existing.addedAt < this.ttlMs) {
        this.duplicateCount += 1;
        return false; // Duplicate
      }
      // Expired entry
      this.cache.delete(id);
    }

    // Bounded eviction if exceeding maxSize
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(id, { addedAt: now });
    return true; // Newly processed
  }

  public has(id: string): boolean {
    const entry = this.cache.get(id);
    if (!entry) return false;
    if (Date.now() - entry.addedAt > this.ttlMs) {
      this.cache.delete(id);
      return false;
    }
    return true;
  }

  public clear(): void {
    this.cache.clear();
    this.duplicateCount = 0;
  }

  public get stats(): { size: number; duplicatesPrevented: number } {
    return {
      size: this.cache.size,
      duplicatesPrevented: this.duplicateCount,
    };
  }

  private evictOldest(): void {
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
