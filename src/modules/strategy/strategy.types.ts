export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface StrategySignal {
  action: SignalAction;
  tokenMint: string;
  tokenSymbol: string;
  sizeSol?: number;
  confidence: number; // 0.0 to 1.0
  reason: string;
  timestamp: Date;
}

export interface StrategyConfig {
  autoTradeEnabled: boolean;
  fixedBuyAmountSol: number;
  takeProfitPct: number; // e.g. 50%
  stopLossPct: number; // e.g. 20%
  maxOpenPositions: number;
}
