import type { RiskGateDecision } from '../risk/risk.types.js';
import type { StrategySignal } from '../strategy/strategy.types.js';

export type SimulatedTradeSide = 'BUY' | 'SELL';

export interface SimulatedOrderRequest {
  tokenMint: string;
  tokenSymbol: string;
  side: SimulatedTradeSide;
  solAmount?: number; // For BUY
  tokenAmount?: number; // For SELL
  currentPriceSol: number;
  maxSlippageBps?: number;
  reason: string;
  riskDecision?: RiskGateDecision;
  strategySignal?: StrategySignal;
  bypassRiskGateForTestingOnly?: boolean;
}

export interface SimulatedExecutionResult {
  tradeId: string;
  tokenMint: string;
  tokenSymbol: string;
  side: SimulatedTradeSide;
  requestedPriceSol: number;
  executedPriceSol: number;
  amountTokens: number;
  totalSol: number;
  simulatedFeeSol: number;
  slippageBpsApplied: number;
  reason: string;
  executedAt: Date;
  isSimulated: true; // Hardcoded guarantee
}

export interface PaperExecutionConfig {
  defaultSlippageBps: number;
  simulatedFeeSol: number;
}
