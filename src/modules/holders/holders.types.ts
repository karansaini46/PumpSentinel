export interface TokenHolder {
  address: string;
  balance: number;
  percentage: number;
  isCreator: boolean;
  isBondingCurve: boolean;
  isSuspectedSniper?: boolean;
}

export interface HolderAnalysisSummary {
  mint: string;
  creatorAddress: string;
  totalHolders: number;
  top10Percentage: number;
  devHoldingPercentage: number;
  bondingCurvePercentage: number;
  suspectedSniperCount: number;
  hasHighConcentration: boolean;
  analyzedAt: Date;
}
