export type EvidenceNature = 'OBSERVED' | 'INFERRED';
export type WarningSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export type HistoricalCoverageType =
  'FULL_HISTORY' | 'PARTIAL_WINDOW' | 'TRUNCATED_BY_BUDGET' | 'INSUFFICIENT_HISTORY';

export type HistoricalRiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export interface EvidenceItem {
  signatures: string[];
  addresses: string[];
  slots?: number[];
  timestamps?: Date[];
  amountSol?: number;
  amountTokens?: number;
  description: string;
  source: string;
  observedAt: Date;
  nature: EvidenceNature;
}

export interface HistoricalWarning {
  code: string;
  title: string;
  severity: WarningSeverity;
  description: string;
  evidence: EvidenceItem;
  detectedAt: Date;
}

export interface HistoricalCoverageReport {
  coverage: HistoricalCoverageType;
  startTime: Date | null;
  endTime: Date | null;
  startSlot: number | null;
  endSlot: number | null;
  totalSignaturesObserved: number;
  isTruncated: boolean;
  reason?: string;
}

export interface PreviousLaunchRecord {
  mint: string;
  symbol?: string;
  deployedAt?: Date;
  initialLiquiditySol?: number;
  evidenceSignature: string;
  slot: number;
  finalOutcome: 'MIGRATED' | 'ABANDONED' | 'DUMPED' | 'ACTIVE' | 'UNKNOWN';
  liquidityDrainedOrPulled: boolean;
  devDumpedAllPct?: number;
}

export interface LargeTransferEvent {
  signature: string;
  slot: number;
  timestamp: Date;
  fromAddress: string;
  toAddress: string;
  amountSol?: number;
  amountTokens?: number;
  tokenMint?: string;
  transferType: 'SOL' | 'TOKEN';
  nature: 'OBSERVED';
}

export interface LargeSellEvent {
  signature: string;
  slot: number;
  timestamp: Date;
  sellerAddress: string;
  poolOrCurveAddress: string;
  tokenMint: string;
  tokenAmount: number;
  solReceived: number;
  percentageOfSupply: number;
  nature: 'OBSERVED';
}

export interface WalletRelationshipRecord {
  walletA: string;
  walletB: string;
  relationshipType:
    | 'COMMON_FUNDER'
    | 'DIRECT_TRANSFER'
    | 'SHARED_FEE_PAYER'
    | 'CO_SIGNER'
    | 'REPEATED_INTERACTIONS'
    | 'SINGLE_INTERACTION';
  interactionCount: number;
  isCommonOwnershipInferred: boolean;
  inferenceReason?: string;
  evidenceSignatures: string[];
  nature: EvidenceNature;
}

export interface EarlyPurchaseCluster {
  tokenMint: string;
  buyerAddress: string;
  signature: string;
  slot: number;
  blockTime?: Date;
  secondsFromLaunch: number;
  solAmount: number;
  tokenAmount: number;
  percentageOfSupply: number;
  isSuspectedSniper: boolean;
  nature: 'OBSERVED';
}

export interface RecurringLaunchPattern {
  patternType: 'SERIAL_FAST_LAUNCHES' | 'LAUNCH_AND_DUMP' | 'LIQUIDITY_PULL_CYCLE';
  frequencyDays?: number;
  tokenCount: number;
  averageLifespanMinutes?: number;
  description: string;
  evidenceSignatures: string[];
  nature: EvidenceNature;
}

export interface KnownHarmfulBehaviorRecord {
  behaviorType:
    | 'CONFIRMED_RUG_PULL'
    | 'LIQUIDITY_DRAIN'
    | 'HONEYPOT_OR_FREEZE_ABUSE'
    | 'RAPID_DEV_DUMP'
    | 'SYBIL_SNIPER_ORCHESTRATION';
  description: string;
  evidence: EvidenceItem;
  confirmedAt: Date;
}

export interface WalletHistoricalProfile {
  walletAddress: string;
  analyzedAt: Date;
  expiresAt: Date;
  freshnessMs: number;
  isFresh: boolean;
  isExpired: boolean;
  coverage: HistoricalCoverageReport;
  launches: PreviousLaunchRecord[];
  largeTransfers: LargeTransferEvent[];
  largeSells: LargeSellEvent[];
  repeatedRelationships: WalletRelationshipRecord[];
  earlyPurchases: EarlyPurchaseCluster[];
  recurringPatterns: RecurringLaunchPattern[];
  knownHarmfulBehaviors: KnownHarmfulBehaviorRecord[];
  warnings: HistoricalWarning[];
  riskLevel: HistoricalRiskLevel;
  riskScore: number; // 0 (safest) to 100 (extreme historical risk)
  isNewWalletWithoutHistory: boolean;
  explanation: string;
}

export interface WalletHistoryAnalysisOptions {
  bypassCache?: boolean;
  maxPages?: number;
  pageSize?: number;
  forceRecalculate?: boolean;
  lookbackDays?: number;
}
