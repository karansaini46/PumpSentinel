import type { WalletHistoricalProfile } from './wallet-history.types.js';

interface CacheEntry {
  profile: WalletHistoricalProfile;
  cachedAt: number;
  expiresAt: number;
}

export class WalletHistoryCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries = 500, defaultTtlMs = 600_000) {
    // Default TTL: 10 minutes
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  public get(wallet: string): WalletHistoricalProfile | undefined {
    const entry = this.store.get(wallet);
    if (!entry) return undefined;

    const now = Date.now();
    const freshnessMs = now - entry.cachedAt;
    const isExpired = now > entry.expiresAt;

    if (isExpired) {
      this.store.delete(wallet);
      return undefined;
    }

    // Refresh LRU order
    this.store.delete(wallet);
    this.store.set(wallet, entry);

    // Return with live freshness metadata
    return {
      ...entry.profile,
      freshnessMs,
      isFresh: freshnessMs < this.defaultTtlMs / 2,
      isExpired: false,
    };
  }

  public set(wallet: string, profile: WalletHistoricalProfile, ttlMs = this.defaultTtlMs): void {
    if (this.store.has(wallet)) {
      this.store.delete(wallet);
    } else if (this.store.size >= this.maxEntries) {
      // LRU eviction
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }

    const now = Date.now();
    const expiresAt = now + ttlMs;

    this.store.set(wallet, {
      profile: {
        ...profile,
        expiresAt: new Date(expiresAt),
      },
      cachedAt: now,
      expiresAt,
    });
  }

  public invalidate(wallet: string): boolean {
    return this.store.delete(wallet);
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}

export const walletHistoryCache = new WalletHistoryCache();
