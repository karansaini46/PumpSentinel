export type TokenLifecycleState =
  'DISCOVERED_ON_CHAIN' | 'METADATA_RETRIEVED' | 'ELIGIBLE_FOR_RISK_ANALYSIS' | 'INELIGIBLE';

export type TokenMetadataStatus = 'PENDING' | 'RESOLVED' | 'FAILED' | 'MISSING';

export interface DiscoveredToken {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  bondingCurve?: string;
  signature: string;
  slot: number;
  initialLiquiditySol: number;
  bondingCurveProgress: number;
  discoveredAt: Date;
  onChainTimestamp: Date;
  discoveryLatencyMs: number;
  source: string;
  isSynthetic: boolean;
  lifecycleState: TokenLifecycleState;
  metadataStatus: TokenMetadataStatus;
}

export interface TokenValidationResult {
  isValid: boolean;
  reason?: string;
}

export interface DiscoveryStats {
  totalDiscovered: number;
  metadataResolvedCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  syntheticCount: number;
  duplicateCount: number;
  processingFailuresCount: number;
  averageDiscoveryLatencyMs: number;
  lastDiscoveredMint: string | null;
  lastProcessedSlot: number;
  lastProcessedSignature: string | null;
  activeCacheSize: number;
}

export interface DiscoveryFilterOptions {
  minInitialSol?: number;
  excludedSymbols?: string[];
}

export interface DiscoveryCursorRecord {
  id: string;
  lastSlot: number;
  lastSignature: string | null;
  lastProcessedAt: Date;
}
