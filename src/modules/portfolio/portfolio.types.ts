export interface PositionDetails {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  amountTokens: number;
  entryPriceSol: number;
  currentPriceSol: number;
  solInvested: number;
  unrealizedPnlSol: number;
  unrealizedPnlPercent: number;
  openedAt: Date;
}

export interface PortfolioSummary {
  initialSolBalance: number;
  currentSolBalance: number;
  totalInvestedSol: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  totalPortfolioValueSol: number;
  totalPnlSol: number;
  totalPnlPercent: number;
  openPositionsCount: number;
  winCount: number;
  lossCount: number;
  winRatePercent: number;
  totalTrades: number;
}
