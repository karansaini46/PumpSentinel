export interface TokenSocialLinks {
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  socials: TokenSocialLinks;
  hasValidUri: boolean;
  isMutable?: boolean;
  fetchedAt: Date;
}

export interface MetadataFetchOptions {
  timeoutMs?: number;
}
