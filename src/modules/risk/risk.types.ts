import type { TokenAnalysisReport } from '../analysis/analysis.types.js';
import type { WalletHistoricalProfile } from '../wallet-history/wallet-history.types.js';

export type RiskCheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
export type HoldingSupplyDenominator = 'CIRCULATING_SUPPLY' | 'TOTAL_SUPPLY';

export type RiskCategory =
  | 'CREATOR_CONCENTRATION'
  | 'TOP_HOLDERS_CONCENTRATION'
  | 'BUNDLED_PURCHASES'
  | 'CREATOR_BEHAVIOR'
  | 'PREVIOUS_HARMFUL_LAUNCHES'
  | 'LIQUIDITY_AND_EXIT'
  | 'TRADING_AND_SELLING'
  | 'TOKEN_AUTHORITIES'
  | 'DATA_COMPLETENESS'
  | 'PRICE_AND_VOLUME';

export type RiskReasonCode =
  | 'CREATOR_CONCENTRATION_PASS'
  | 'CREATOR_CONCENTRATION_EXCEEDS_LIMIT'
  | 'CREATOR_CONCENTRATION_UNKNOWN'
  | 'TOP_HOLDERS_CONCENTRATION_PASS'
  | 'TOP_HOLDERS_CONCENTRATION_EXCEEDS_LIMIT'
  | 'TOP_HOLDERS_CONCENTRATION_UNKNOWN'
  | 'BUNDLED_PURCHASES_PASS'
  | 'BUNDLED_PURCHASES_EXCEEDS_LIMIT'
  | 'BUNDLED_PURCHASES_PROBABILISTIC_WARN'
  | 'BUNDLED_PURCHASES_UNKNOWN'
  | 'CREATOR_BEHAVIOR_PASS'
  | 'CREATOR_BEHAVIOR_SUSPICIOUS'
  | 'CREATOR_BEHAVIOR_UNKNOWN'
  | 'PREVIOUS_HARMFUL_LAUNCHES_PASS'
  | 'PREVIOUS_HARMFUL_LAUNCHES_FAIL'
  | 'PREVIOUS_HARMFUL_LAUNCHES_UNVERIFIED_NEW'
  | 'PREVIOUS_HARMFUL_LAUNCHES_UNKNOWN'
  | 'LIQUIDITY_EXIT_PASS'
  | 'LIQUIDITY_INSUFFICIENT'
  | 'EXIT_PRICE_IMPACT_HIGH'
  | 'LIQUIDITY_EXIT_UNKNOWN'
  | 'TRADING_SELLING_PASS'
  | 'TRADING_SELLING_DUMP_DETECTED'
  | 'TRADING_SELLING_UNKNOWN'
  | 'TOKEN_AUTHORITIES_PASS'
  | 'TOKEN_AUTHORITIES_MINT_NOT_REVOKED'
  | 'TOKEN_AUTHORITIES_FREEZE_NOT_REVOKED'
  | 'TOKEN_AUTHORITIES_UNKNOWN'
  | 'DATA_COMPLETENESS_PASS'
  | 'DATA_COMPLETENESS_CRITICAL_MISSING'
  | 'DATA_COMPLETENESS_STALE'
  | 'PRICE_VOLUME_PASS'
  | 'PRICE_VOLUME_ANOMALY'
  | 'PRICE_VOLUME_UNKNOWN';

export interface RiskEvidence {
  metrics: Record<string, number | string | boolean | null>;
  denominator?: HoldingSupplyDenominator;
  signatures?: string[];
  addresses?: string[];
  explanation: string;
}

export interface RiskCheckResult {
  category: RiskCategory;
  status: RiskCheckStatus;
  reasonCode: RiskReasonCode;
  evidence: RiskEvidence;
  source: string;
  observedAt: Date;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface DeterministicRiskEngineConfig {
  creatorHoldingsThresholdPct: number; // default: 10.0%
  suspectedBundleThresholdPct: number; // default: 25.0%
  minLiquiditySol: number; // default: 15.0 SOL
  maxTop10ConcentrationPct: number; // default: 30.0%
  maxSellPriceImpactPct: number; // default: 20.0% for 1 SOL sell
  requireRevokedMintAuthority: boolean; // default: true
  requireRevokedFreezeAuthority: boolean; // default: true
  minDataCompletenessPct: number; // default: 75.0%
  holdingDenominator: HoldingSupplyDenominator; // default: TOTAL_SUPPLY
}

export interface TokenRiskReport {
  mint: string;
  symbol: string;
  overallStatus: RiskCheckStatus;
  passed: boolean;
  overallScore: number; // 0 (safest) to 100 (extreme risk)
  summary: string;
  checks: Record<RiskCategory, RiskCheckResult>;
  criticalFlags: string[];
  warningFlags: string[];
  assessedAt: Date;
  denominatorUsed: HoldingSupplyDenominator;
}

export interface ComprehensiveRiskInput {
  mint: string;
  symbol: string;
  analysisReport?: TokenAnalysisReport;
  creatorHistory?: WalletHistoricalProfile;
  rawHolders?: Array<{
    ownerAddress: string;
    tokenAccountAddress?: string;
    balance: number;
    isBondingCurve?: boolean;
    isCreator?: boolean;
  }>;
  customLiquiditySol?: number;
  customCreatorHoldingPct?: number;
  customTop10HoldingPct?: number;
  customBundledSupplyPct?: number;
  isBundleVerified?: boolean;
}

// ---------------------------------------------------------------------------
// Backward-compatibility interfaces for existing code & tests
// ---------------------------------------------------------------------------
export interface RiskAssessmentInput {
  mint: string;
  symbol: string;
  liquiditySol: number;
  top10HoldingPct: number;
  devHoldingPct: number;
  hasValidMetadata: boolean;
  hasSocials: boolean;
  suspectedSniperCount: number;
}

export interface RiskRuleConfig {
  maxTop10HoldingPct: number;
  maxDevHoldingPct: number;
  minLiquiditySol: number;
  maxSniperCount: number;
  requireSocials: boolean;
}

export interface RiskAssessmentResult {
  mint: string;
  score: number;
  passed: boolean;
  reasons: string[];
  assessedAt: Date;
}
