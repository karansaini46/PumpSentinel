import type {
  Token,
  RiskAnalysis,
  PaperPosition,
  PaperTrade,
  PortfolioAccount,
  SentinelEventLog,
} from '@prisma/client';

export type { Token, RiskAnalysis, PaperPosition, PaperTrade, PortfolioAccount, SentinelEventLog };

export interface CreateTokenInput {
  mintAddress: string;
  name: string;
  symbol: string;
  uri?: string;
  decimals?: number;
  creator: string;
  marketCapSol?: number;
  priceSol?: number;
  liquiditySol?: number;
  bondingCurveProgress?: number;
  status?: string;
  lifecycleState?: string;
  metadataStatus?: string;
  signature?: string;
  slot?: number;
  bondingCurveAddress?: string;
  source?: string;
  isSynthetic?: boolean;
  discoveryLatencyMs?: number;
  onChainTimestamp?: Date;
}

export interface CreatePaperTradeInput {
  positionId?: string;
  tokenMint: string;
  side: 'BUY' | 'SELL';
  amountTokens: number;
  priceSol: number;
  totalSol: number;
  simulatedFeeSol: number;
  slippageBps: number;
  reason: string;
}

export interface CreateRiskAnalysisInput {
  tokenMint: string;
  score: number;
  passed: boolean;
  top10HoldingPct: number;
  devHoldingPct: number;
  liquiditySol: number;
  reasons: string[];
}
