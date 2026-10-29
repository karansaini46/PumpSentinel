import type { TokenMetadata, MetadataFetchOptions } from './metadata.types.js';
import { logger } from '../observability/logger.js';

export class MetadataService {
  private cache = new Map<string, TokenMetadata>();
  private readonly maxCacheSize: number;

  constructor(maxCacheSize = 500) {
    this.maxCacheSize = maxCacheSize;
  }

  public async resolveMetadata(
    mint: string,
    uri: string,
    fallbackName: string,
    fallbackSymbol: string,
    options: MetadataFetchOptions = {},
  ): Promise<TokenMetadata> {
    const cached = this.cache.get(mint);
    if (cached) return cached;

    const timeout = options.timeoutMs ?? 3000;
    let description: string | undefined;
    let image: string | undefined;
    const socials: TokenMetadata['socials'] = {};
    let hasValidUri = false;

    if (uri && (uri.startsWith('http://') || uri.startsWith('https://'))) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const res = await fetch(uri, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
          hasValidUri = true;
          const data = (await res.json()) as Record<string, unknown>;
          description = typeof data['description'] === 'string' ? data['description'] : undefined;
          image = typeof data['image'] === 'string' ? data['image'] : undefined;

          if (typeof data['twitter'] === 'string') socials.twitter = data['twitter'];
          if (typeof data['telegram'] === 'string') socials.telegram = data['telegram'];
          if (typeof data['website'] === 'string') socials.website = data['website'];
        }
      } catch (err) {
        logger.debug({ err, uri, mint }, '[MetadataService] Failed to fetch external URI');
      }
    }

    const metadata: TokenMetadata = {
      mint,
      name: fallbackName,
      symbol: fallbackSymbol,
      description,
      image,
      socials,
      hasValidUri,
      fetchedAt: new Date(),
    };

    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(mint, metadata);

    return metadata;
  }

  public getCached(mint: string): TokenMetadata | undefined {
    return this.cache.get(mint);
  }
}

export const metadataService = new MetadataService();
