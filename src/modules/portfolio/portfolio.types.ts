export interface PortfolioConfig {
  /**
   * Starting portfolio balance in USD. Default: $800.0.
   */
  startingBalanceUsd: number;

  /**
   * Default position size in USD. Default: $20.0.
   */
  defaultPositionSizeUsd: number;

  /**
   * Maximum concurrent open positions. Default: 5.
   */
  maxConcurrentPositions: number;

  /**
   * Configurable take-profit percentage (e.g. 50.0 for +50%).
   */
  takeProfitPct: number;

  /**
   * Configurable stop-loss percentage (e.g. 20.0 for -20%).
   */
  stopLossPct: number;

  /**
   * Configurable maximum holding time in milliseconds (e.g. 3,600,000 ms = 1 hour).
   */
  maxHoldingTimeMs: number;

  /**
   * Reference SOL price in USD for dual-currency accounting. Default: $160.0.
   */
  solPriceUsd: number;
}

export interface PositionDetails {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  amountTokens: number;
  entryPriceSol: number;
  entryPriceUsd: number;
  currentPriceSol: number;
  currentPriceUsd: number;
  solInvested: number;
  usdInvested: number;
  unrealizedPnlSol: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number;
  openedAt: Date;
  status: 'OPEN' | 'CLOSED' | 'EMERGENCY_CLOSED';
  closedAt?: Date;
  closeReason?: string;
  totalFeesSol: number;
  totalFeesUsd: number;
}

export interface PortfolioSummary {
  // Cash & Balance
  initialBalanceUsd: number;
  currentCashBalanceUsd: number;
  initialSolBalance: number;
  currentSolBalance: number;

  // Investment & Holdings
  totalInvestedUsd: number;
  totalInvestedSol: number;
  openPositionsValueUsd: number;
  openPositionsValueSol: number;
  totalPortfolioValueUsd: number;
  totalPortfolioValueSol: number;

  // Realized & Unrealized P&L
  realizedPnlUsd: number;
  realizedPnlSol: number;
  unrealizedPnlUsd: number;
  unrealizedPnlSol: number;
  totalPnlUsd: number;
  totalPnlSol: number;
  totalPnlPercent: number;

  // Fees
  totalFeesPaidUsd: number;
  totalFeesPaidSol: number;

  // Operations & Performance
  openPositionsCount: number;
  maxConcurrentPositions: number;
  winCount: number;
  lossCount: number;
  winRatePercent: number;
  totalTrades: number;

  // Configuration snapshot
  defaultPositionSizeUsd: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldingTimeMs: number;
  solPriceUsd: number;
}

export interface ReconciliationReport {
  timestamp: Date;
  initialBalanceUsd: number;
  initialBalanceSol: number;
  calculatedCashBalanceSol: number;
  calculatedCashBalanceUsd: number;
  recordedCashBalanceSol: number;
  discrepancySol: number;
  isAuditedAndReconciled: boolean;
  activePositionsCount: number;
  restoredPositions: string[];
  totalRealizedPnlSol: number;
  totalFeesPaidSol: number;
  totalTradesReplayed: number;
  auditNotes: string[];
}
