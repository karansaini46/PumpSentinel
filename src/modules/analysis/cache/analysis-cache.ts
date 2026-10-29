import type {
  TokenAnalysisReport,
  CreatorHistoryAnalysis,
  TokenAuthoritiesAnalysis,
} from '../analysis.types.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedTtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries = 500, defaultTtlMs = 30000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  public get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh access order (LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  public set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Evict oldest (least recently used)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}

export class AnalysisCacheManager {
  // Reports: TTL 30s
  public readonly reports = new BoundedTtlCache<TokenAnalysisReport>(500, 30_000);

  // Creator profile history: TTL 10 min
  public readonly creatorHistory = new BoundedTtlCache<CreatorHistoryAnalysis>(500, 600_000);

  // Token authorities & supply: TTL 5 min
  public readonly authorities = new BoundedTtlCache<TokenAuthoritiesAnalysis>(500, 300_000);

  public clearAll(): void {
    this.reports.clear();
    this.creatorHistory.clear();
    this.authorities.clear();
  }
}

export const analysisCache = new AnalysisCacheManager();
