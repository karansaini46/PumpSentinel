import type { IngestionTokenCreatedEvent } from '../ingestion/ingestion.types.js';
import type { TokenAnalysisReport } from '../analysis/analysis.types.js';

/**
 * Origin of the dataset or fixture.
 * Requirement: Clearly separate measured results from synthetic results.
 */
export type DatasetOrigin = 'HISTORICAL_MEASURED' | 'SYNTHETIC_STRESS_TEST';

/**
 * Ground truth label for risk classification analysis.
 */
export type GroundTruthLabel = 'RUG_PULL' | 'LEGITIMATE' | 'UNKNOWN';

/**
 * Market condition stress scenarios to simulate.
 */
export type StressScenarioType =
  | 'RAPID_PRICE_CRASH'
  | 'RUG_PULL'
  | 'HIGH_SLIPPAGE'
  | 'LOW_LIQUIDITY'
  | 'FAILED_EXIT'
  | 'MISSING_AND_STALE_DATA'
  | 'TRANSACTION_SPIKE'
  | 'DUPLICATE_EVENTS'
  | 'PROVIDER_OUTAGE'
  | 'TELEGRAM_DELIVERY_FAILURE'
  | 'STANDARD_PUMP'
  | 'NORMAL_MARKET';

/**
 * Timestamped market feed quote for backtesting.
 */
export interface BacktestPriceQuote {
  timestamp: number; // Unix timestamp in ms
  priceSol: number;
  liquiditySol: number;
  volumeSol?: number;
  priceImpactPct?: number;
}

/**
 * A discrete token scenario in historical or synthetic backtesting.
 */
export interface HistoricalTokenScenario {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  bondingCurve?: string;
  origin: DatasetOrigin;
  groundTruth: GroundTruthLabel;
  scenarioType: StressScenarioType;
  description: string;

  // On-chain discovery event
  discoveryEvent: IngestionTokenCreatedEvent;

  // Point-in-time analysis report (available at discovery timestamp)
  analysisReport: TokenAnalysisReport;

  // Subsequent price history series (strictly chronological)
  priceHistory: BacktestPriceQuote[];

  // Adversarial flags
  adversarialFlags?: {
    simulateFailedExit?: boolean;
    failCountBeforeExit?: number;
    staleQuoteAgeMs?: number;
    duplicateCount?: number;
    providerOutageDurationMs?: number;
    telegramFailures?: boolean;
  };
}

/**
 * Executed backtest trade record.
 */
export interface BacktestTrade {
  tradeId: string;
  tokenMint: string;
  tokenSymbol: string;
  side: 'BUY' | 'SELL';
  amountTokens: number;
  entryPriceSol: number;
  exitPriceSol: number;
  totalSolInvested: number;
  exitTotalSol: number;
  pnlSol: number;
  pnlUsd: number;
  pnlPercent: number;
  holdingDurationMs: number;
  entryTimestamp: number;
  exitTimestamp: number;
  exitReason: string;
  simulatedFeesSol: number;
  slippageBpsApplied: number;
  groundTruth: GroundTruthLabel;
  origin: DatasetOrigin;
}

/**
 * Financial metrics calculated from trading activity.
 */
export interface FinancialMetrics {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRatePct: number;

  totalSolInvested: number;
  netPnlSol: number;
  netPnlUsd: number;
  grossProfitSol: number;
  grossLossSol: number;
  profitFactor: number;

  maxDrawdownPct: number;
  maxDrawdownSol: number;
  peakEquitySol: number;
  endingEquitySol: number;

  averageWinSol: number;
  averageLossSol: number;
  winLossRatio: number;

  averageHoldingDurationMs: number;
  medianHoldingDurationMs: number;
  minHoldingDurationMs: number;
  maxHoldingDurationMs: number;

  totalFeesPaidSol: number;

  // Statistical confidence & sample size humility
  sampleSizeAdequate: boolean; // false if trades < 30
  smallSampleWarning: string | null;
  winRateStandardError: number;
  winRateConfidenceInterval95: [number, number]; // [lower, upper] percentage
  netPnlStandardErrorSol: number;
}

/**
 * Risk classification confusion matrix & performance metrics.
 */
export interface RiskClassificationMetrics {
  totalLabeledTokens: number;
  truePositives: number; // Correctly rejected rug-pulls
  falsePositives: number; // Mistakenly rejected legitimate tokens (false alarm)
  trueNegatives: number; // Correctly allowed legitimate tokens
  falseNegatives: number; // Mistakenly allowed rug-pulls (disaster)

  precisionPct: number; // TP / (TP + FP)
  recallPct: number; // TP / (TP + FN) - Scam Catch Rate
  specificityPct: number; // TN / (TN + FP)
  f1Score: number; // 2 * P * R / (P + R)
  accuracyPct: number; // (TP + TN) / Total
}

/**
 * Details of tokens rejected by risk engine that subsequently appreciated.
 */
export interface MissedOpportunity {
  tokenMint: string;
  tokenSymbol: string;
  discoveryTimestamp: number;
  initialPriceSol: number;
  peakPriceSol: number;
  maxPumpPct: number;
  rejectionReasons: string[];
  rejectionScore: number;
}

/**
 * Segment evaluation results (e.g. In-Sample vs Out-of-Sample, Measured vs Synthetic).
 */
export interface EvaluationSegmentResult {
  segmentName: string;
  origin: DatasetOrigin | 'COMBINED';
  sampleSplit: 'IN_SAMPLE' | 'OUT_OF_SAMPLE' | 'FULL_DATASET';
  tokenCount: number;
  evaluatedCount: number;
  rejectedCount: number;
  rejectionRatePct: number;
  rejectionReasonBreakdown: Record<string, number>;

  financialMetrics: FinancialMetrics;
  classificationMetrics: RiskClassificationMetrics;
  missedOpportunities: MissedOpportunity[];
  trades: BacktestTrade[];
}

/**
 * Baseline strategy types for benchmarking.
 */
export type BaselineStrategyType =
  | 'PUMP_SENTINEL' // PumpSentinel strategy (Deterministic gate + risk controller)
  | 'BUY_ALL_NAIVE' // Naive baseline: buys all tokens regardless of safety
  | 'MOMENTUM_ONLY' // Buys high-liquidity tokens without authority/sybil checks
  | 'RANDOM_ENTRY'; // Random entry decision maker

/**
 * Baseline comparison summary.
 */
export interface BaselineComparison {
  strategy: BaselineStrategyType;
  description: string;
  tradeCount: number;
  winRatePct: number;
  netPnlSol: number;
  profitFactor: number;
  maxDrawdownPct: number;
  scamsEnteredCount: number;
}

/**
 * Full backtest and evaluation report outcome.
 */
export interface BacktestEvaluationReport {
  id: string;
  executedAt: string;
  totalTokens: number;
  measuredTokenCount: number;
  syntheticTokenCount: number;

  inSampleResult: EvaluationSegmentResult;
  outOfSampleResult: EvaluationSegmentResult;
  measuredResults: EvaluationSegmentResult;
  syntheticResults: EvaluationSegmentResult;
  combinedResults: EvaluationSegmentResult;

  baselines: BaselineComparison[];
  adversarialScenarioResults: Record<
    StressScenarioType,
    {
      testedCount: number;
      passedSafety: boolean;
      summary: string;
    }
  >;

  markdownReport: string;
}

/**
 * Backtest engine execution options.
 */
export interface BacktestOptions {
  startingBalanceSol?: number;
  fixedPositionSizeSol?: number;
  solPriceUsd?: number;
  inSampleRatio?: number; // Default: 0.65 (65% in-sample, 35% out-of-sample)
  customScenarios?: HistoricalTokenScenario[];
  strictLookaheadCheck?: boolean; // Default: true
  generateMarkdownReport?: boolean; // Default: true
}
