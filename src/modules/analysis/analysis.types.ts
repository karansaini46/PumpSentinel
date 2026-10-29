export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type FreshnessState = 'FRESH' | 'STALE' | 'EXPIRED';
export type ObservationNature = 'DIRECT' | 'INFERRED';
export type FieldStatus = 'CONFIRMED' | 'UNKNOWN' | 'STALE' | 'CONTRADICTORY';

export const UNKNOWN = 'UNKNOWN' as const;
export type UnknownValue = typeof UNKNOWN;

/**
 * Standardized representation for every analyzed data field.
 * Guarantees provenance, observation timestamp, confidence,
 * freshness, and whether the data was directly observed or inferred.
 */
export interface AnalyzedField<T> {
  value: T | UnknownValue;
  source: string;
  observedAt: Date;
  confidence: ConfidenceLevel;
  confidenceScore: number; // 0.0 to 1.0
  freshness: FreshnessState;
  freshnessMs: number;
  nature: ObservationNature;
  status: FieldStatus;
  reason?: string;
}

export interface CreateFieldOptions {
  source: string;
  observedAt?: Date;
  confidence?: ConfidenceLevel;
  confidenceScore?: number;
  nature?: ObservationNature;
  status?: FieldStatus;
  reason?: string;
  staleThresholdMs?: number;
  expiredThresholdMs?: number;
}

export const DEFAULT_STALE_THRESHOLD_MS = 60_000; // 60s
export const DEFAULT_EXPIRED_THRESHOLD_MS = 300_000; // 5 min

export function evaluateFreshness(
  observedAt: Date,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  expiredThresholdMs = DEFAULT_EXPIRED_THRESHOLD_MS,
): { freshness: FreshnessState; freshnessMs: number } {
  const freshnessMs = Math.max(0, Date.now() - observedAt.getTime());
  let freshness: FreshnessState = 'FRESH';
  if (freshnessMs >= expiredThresholdMs) {
    freshness = 'EXPIRED';
  } else if (freshnessMs >= staleThresholdMs) {
    freshness = 'STALE';
  }
  return { freshness, freshnessMs };
}

export function confidenceToScore(level: ConfidenceLevel): number {
  switch (level) {
    case 'HIGH':
      return 0.95;
    case 'MEDIUM':
      return 0.7;
    case 'LOW':
      return 0.35;
  }
}

export function scoreToConfidence(score: number): ConfidenceLevel {
  if (score >= 0.85) return 'HIGH';
  if (score >= 0.5) return 'MEDIUM';
  return 'LOW';
}

/**
 * Construct an AnalyzedField for a known/observed value.
 */
export function createField<T>(value: T, options: CreateFieldOptions): AnalyzedField<T> {
  const observedAt = options.observedAt ?? new Date();
  const { freshness, freshnessMs } = evaluateFreshness(
    observedAt,
    options.staleThresholdMs,
    options.expiredThresholdMs,
  );

  const initialConfidence = options.confidence ?? 'HIGH';
  let confidenceScore = options.confidenceScore ?? confidenceToScore(initialConfidence);

  let status: FieldStatus = options.status ?? 'CONFIRMED';
  if (freshness === 'STALE' && status === 'CONFIRMED') {
    status = 'STALE';
    confidenceScore = Math.max(0.1, confidenceScore * 0.7);
  } else if (freshness === 'EXPIRED' && status === 'CONFIRMED') {
    status = 'STALE';
    confidenceScore = Math.max(0.05, confidenceScore * 0.4);
  }

  return {
    value,
    source: options.source,
    observedAt,
    confidence: scoreToConfidence(confidenceScore),
    confidenceScore: Math.round(confidenceScore * 100) / 100,
    freshness,
    freshnessMs,
    nature: options.nature ?? 'DIRECT',
    status,
    reason: options.reason,
  };
}

/**
 * Construct an AnalyzedField when data is missing or unavailable.
 * Never defaults to zero.
 */
export function createUnknownField<T>(
  source: string,
  reason: string,
  nature: ObservationNature = 'DIRECT',
): AnalyzedField<T> {
  const observedAt = new Date();
  return {
    value: UNKNOWN,
    source,
    observedAt,
    confidence: 'LOW',
    confidenceScore: 0.0,
    freshness: 'FRESH',
    freshnessMs: 0,
    nature,
    status: 'UNKNOWN',
    reason,
  };
}

/**
 * Construct an AnalyzedField when conflicting data is discovered across sources.
 */
export function createContradictoryField<T>(
  resolvedValue: T | UnknownValue,
  source: string,
  reason: string,
  nature: ObservationNature = 'INFERRED',
): AnalyzedField<T> {
  const observedAt = new Date();
  return {
    value: resolvedValue,
    source,
    observedAt,
    confidence: 'LOW',
    confidenceScore: 0.25,
    freshness: 'FRESH',
    freshnessMs: 0,
    nature,
    status: 'CONTRADICTORY',
    reason,
  };
}

// ---------------------------------------------------------------------------
// Section 1: Token Mint and Supply
// ---------------------------------------------------------------------------
export interface TokenSupplyAnalysis {
  mint: AnalyzedField<string>;
  supply: AnalyzedField<number>;
  rawSupply: AnalyzedField<string>;
  decimals: AnalyzedField<number>;
  isInitialized: AnalyzedField<boolean>;
}

// ---------------------------------------------------------------------------
// Section 2: Creator Wallet
// ---------------------------------------------------------------------------
export interface CreatorWalletAnalysis {
  address: AnalyzedField<string>;
  solBalance: AnalyzedField<number>;
  exists: AnalyzedField<boolean>;
  accountType: AnalyzedField<'SYSTEM_ACCOUNT' | 'PROGRAM_ACCOUNT' | 'UNKNOWN'>;
}

// ---------------------------------------------------------------------------
// Section 3: Current Holder Distribution
// ---------------------------------------------------------------------------
export interface HolderDistributionAnalysis {
  totalHoldersCount: AnalyzedField<number>;
  top5PercentShare: AnalyzedField<number>;
  top10PercentShare: AnalyzedField<number>;
  top20PercentShare: AnalyzedField<number>;
  concentrationLevel: AnalyzedField<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>;
  giniCoefficient: AnalyzedField<number>;
}

// ---------------------------------------------------------------------------
// Section 4: Creator's Token Holdings
// ---------------------------------------------------------------------------
export interface CreatorHoldingsAnalysis {
  creatorAddress: AnalyzedField<string>;
  tokenBalance: AnalyzedField<number>;
  percentageOfSupply: AnalyzedField<number>;
  hasSoldTokens: AnalyzedField<boolean>;
  holdingStatus: AnalyzedField<'HOLDING' | 'REDUCED' | 'DUMPED_ALL' | 'NEVER_HELD'>;
}

// ---------------------------------------------------------------------------
// Section 5: Largest Holder Concentrations
// ---------------------------------------------------------------------------
export interface TopHolderEntry {
  address: string;
  balance: number;
  percentage: number;
  isBondingCurve: boolean;
  isCreator: boolean;
  label?: string;
}

export interface LargestHoldersAnalysis {
  topHolders: AnalyzedField<TopHolderEntry[]>;
  nonCurveTop10Percentage: AnalyzedField<number>;
  bondingCurvePercentage: AnalyzedField<number>;
  hasHighConcentration: AnalyzedField<boolean>;
  observedAccountsCount: AnalyzedField<number>;
}

// ---------------------------------------------------------------------------
// Section 6: Recent Buy and Sell Activity
// ---------------------------------------------------------------------------
export interface NormalizedTradeActivity {
  signature: string;
  slot: number;
  timestamp: Date;
  side: 'BUY' | 'SELL';
  solAmount: number;
  tokenAmount: number;
  user: string;
}

export interface RecentActivityAnalysis {
  observationWindowSeconds: AnalyzedField<number>;
  totalTransactions: AnalyzedField<number>;
  buyCount: AnalyzedField<number>;
  sellCount: AnalyzedField<number>;
  buyVolumeSol: AnalyzedField<number>;
  sellVolumeSol: AnalyzedField<number>;
  netFlowSol: AnalyzedField<number>;
  recentTrades: AnalyzedField<NormalizedTradeActivity[]>;
}

// ---------------------------------------------------------------------------
// Section 7: Liquidity and Market Depth
// ---------------------------------------------------------------------------
export interface MarketDepthBucket {
  orderSolAmount: number;
  estimatedPriceImpactPct: number;
  estimatedTokensOut: number;
}

export interface LiquidityMarketDepthAnalysis {
  liquiditySol: AnalyzedField<number>;
  tokenReserves: AnalyzedField<number>;
  virtualSolReserves: AnalyzedField<number>;
  virtualTokenReserves: AnalyzedField<number>;
  currentPriceSol: AnalyzedField<number>;
  marketDepth: AnalyzedField<MarketDepthBucket[]>;
  bondingCurveProgressPct: AnalyzedField<number>;
}

// ---------------------------------------------------------------------------
// Section 8: Trading Volume
// ---------------------------------------------------------------------------
export interface TradingVolumeAnalysis {
  totalVolumeSol: AnalyzedField<number>;
  buyVolumeSol: AnalyzedField<number>;
  sellVolumeSol: AnalyzedField<number>;
  tradeCount: AnalyzedField<number>;
  windowSeconds: AnalyzedField<number>;
}

// ---------------------------------------------------------------------------
// Section 9: Token Authorities
// ---------------------------------------------------------------------------
export interface TokenAuthoritiesAnalysis {
  mintAuthority: AnalyzedField<string | null>;
  freezeAuthority: AnalyzedField<string | null>;
  isMintAuthorityRevoked: AnalyzedField<boolean>;
  isFreezeAuthorityRevoked: AnalyzedField<boolean>;
  updateAuthority: AnalyzedField<string | null>;
}

// ---------------------------------------------------------------------------
// Section 10: Related Wallet Activity
// ---------------------------------------------------------------------------
export type WalletEvidenceType =
  'COMMON_FUNDER' | 'DIRECT_TRANSFER' | 'SHARED_FEE_PAYER' | 'CO_SIGNER';

export interface WalletConnectionEvidence {
  targetWallet: string;
  relatedWallet: string;
  evidenceType: WalletEvidenceType;
  confidence: ConfidenceLevel;
  description: string;
  funderAddress?: string;
  transactionSignature?: string;
  transferAmountSol?: number;
  detectedAt: Date;
}

export interface DismissedWalletLink {
  walletA: string;
  walletB: string;
  claimedRelation: string;
  reason: string;
}

export interface RelatedWalletsAnalysis {
  linkedWallets: AnalyzedField<WalletConnectionEvidence[]>;
  connectedWalletCount: AnalyzedField<number>;
  dismissedNonEvidenceLinks: AnalyzedField<DismissedWalletLink[]>;
  hasSybilCluster: AnalyzedField<boolean>;
}

// ---------------------------------------------------------------------------
// Section 11: Historical Creator Activity
// ---------------------------------------------------------------------------
export type CreatorReputationTier =
  'ESTABLISHED_SAFE' | 'FRESH_WALLET' | 'PROLIFIC_CREATOR' | 'SUSPECTED_SERIAL_RUGGER' | 'UNKNOWN';

export interface CreatorPastTokenSummary {
  mint: string;
  symbol?: string;
  createdAt?: Date;
  liquidityPulledOrDumped: boolean;
  finalOutcome: 'MIGRATED' | 'ABANDONED' | 'DUMPED' | 'ACTIVE' | 'UNKNOWN';
}

export interface CreatorHistoryAnalysis {
  totalPastTokensLaunched: AnalyzedField<number>;
  pastTokens: AnalyzedField<CreatorPastTokenSummary[]>;
  walletAgeDays: AnalyzedField<number>;
  firstSeenSlot: AnalyzedField<number>;
  rugPullCount: AnalyzedField<number>;
  reputationTier: AnalyzedField<CreatorReputationTier>;
  reputationRiskScore: AnalyzedField<number>; // 0 (safest) to 100 (highest risk)
}

// ---------------------------------------------------------------------------
// Complete Aggregated Analysis Report
// ---------------------------------------------------------------------------
export interface TokenAnalysisReport {
  mint: string;
  symbol: string;
  analyzedAt: Date;
  executionDurationMs: number;
  isCacheHit: boolean;
  budgetUsed: {
    rpcRequestsUsed: number;
    rpcBudgetLimit: number;
    budgetExhausted: boolean;
  };
  supply: TokenSupplyAnalysis;
  creatorWallet: CreatorWalletAnalysis;
  holderDistribution: HolderDistributionAnalysis;
  creatorHoldings: CreatorHoldingsAnalysis;
  largestHolders: LargestHoldersAnalysis;
  recentActivity: RecentActivityAnalysis;
  liquidityAndDepth: LiquidityMarketDepthAnalysis;
  volume: TradingVolumeAnalysis;
  authorities: TokenAuthoritiesAnalysis;
  relatedWallets: RelatedWalletsAnalysis;
  creatorHistory: CreatorHistoryAnalysis;
  overallSummary: {
    dataCompletenessPct: number;
    confidenceWeightedScore: number;
    staleFieldCount: number;
    contradictoryFieldCount: number;
    unknownFieldCount: number;
  };
}

export interface TokenAnalysisOptions {
  bypassCache?: boolean;
  rpcBudget?: number;
  bondingCurveAddress?: string;
  creatorAddress?: string;
  initialLiquiditySol?: number;
  isSynthetic?: boolean;
}
