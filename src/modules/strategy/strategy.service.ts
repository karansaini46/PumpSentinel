import type { StrategySignal, StrategyConfig } from './strategy.types.js';
import type { RiskAssessmentResult, RiskGateDecision } from '../risk/risk.types.js';
import type { DiscoveredToken } from '../discovery/discovery.types.js';
import type { PaperPosition } from '../persistence/persistence.types.js';

export class StrategyService {
  private config: StrategyConfig;

  constructor(customConfig?: Partial<StrategyConfig>) {
    this.config = {
      autoTradeEnabled: customConfig?.autoTradeEnabled ?? false,
      fixedBuyAmountSol: customConfig?.fixedBuyAmountSol ?? 0.5,
      takeProfitPct: customConfig?.takeProfitPct ?? 50.0,
      stopLossPct: customConfig?.stopLossPct ?? 20.0,
      maxOpenPositions: customConfig?.maxOpenPositions ?? 5,
    };
  }

  public updateConfig(newConfig: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): Readonly<StrategyConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Evaluate whether a newly discovered token passes risk & strategy entry filters.
   * Rule 7: The strategy cannot override a risk rejection.
   */
  public evaluateEntry(
    token: DiscoveredToken,
    risk: RiskAssessmentResult | RiskGateDecision,
    openPositionsCount: number,
  ): StrategySignal {
    // Rule 7: The strategy CANNOT override a risk rejection under any circumstances
    if ('outcome' in risk) {
      if (risk.outcome !== 'ELIGIBLE_FOR_STRATEGY' || !risk.passed) {
        return {
          action: 'HOLD',
          tokenMint: token.mint,
          tokenSymbol: token.symbol,
          confidence: 0,
          reason: `Risk gate outcome '${risk.outcome}' prevents strategy entry: ${risk.reasons.join('; ')}`,
          timestamp: new Date(),
        };
      }
    } else {
      if (!risk.passed) {
        return {
          action: 'HOLD',
          tokenMint: token.mint,
          tokenSymbol: token.symbol,
          confidence: 0,
          reason: `Risk assessment failed: ${risk.reasons.join(', ')}`,
          timestamp: new Date(),
        };
      }
    }

    if (!this.config.autoTradeEnabled) {
      return {
        action: 'HOLD',
        tokenMint: token.mint,
        tokenSymbol: token.symbol,
        confidence: 0,
        reason: 'Auto paper-trading is currently disabled',
        timestamp: new Date(),
      };
    }

    if (openPositionsCount >= this.config.maxOpenPositions) {
      return {
        action: 'HOLD',
        tokenMint: token.mint,
        tokenSymbol: token.symbol,
        confidence: 0,
        reason: `Maximum open positions limit reached (${this.config.maxOpenPositions})`,
        timestamp: new Date(),
      };
    }

    // High confidence entry signal
    const riskScoreInfo =
      'score' in risk ? `risk score ${risk.score}/100` : `risk gate outcome ELIGIBLE_FOR_STRATEGY`;

    return {
      action: 'BUY',
      tokenMint: token.mint,
      tokenSymbol: token.symbol,
      sizeSol: this.config.fixedBuyAmountSol,
      confidence: 0.85,
      reason: `Safe token discovered with ${riskScoreInfo} and initial liquidity ${token.initialLiquiditySol} SOL`,
      timestamp: new Date(),
    };
  }

  /**
   * Evaluate whether an existing position should exit via Take Profit or Stop Loss
   */
  public evaluateExit(position: PaperPosition, currentPriceSol: number): StrategySignal {
    if (position.entryPriceSol <= 0) {
      return {
        action: 'HOLD',
        tokenMint: position.tokenMint,
        tokenSymbol: position.tokenSymbol,
        confidence: 0,
        reason: 'Invalid entry price',
        timestamp: new Date(),
      };
    }

    const priceChangePct =
      ((currentPriceSol - position.entryPriceSol) / position.entryPriceSol) * 100;

    // Check Take Profit
    if (priceChangePct >= this.config.takeProfitPct) {
      return {
        action: 'SELL',
        tokenMint: position.tokenMint,
        tokenSymbol: position.tokenSymbol,
        confidence: 0.95,
        reason: `Take profit target hit: +${priceChangePct.toFixed(2)}% (target: +${this.config.takeProfitPct}%)`,
        timestamp: new Date(),
      };
    }

    // Check Stop Loss
    if (priceChangePct <= -this.config.stopLossPct) {
      return {
        action: 'SELL',
        tokenMint: position.tokenMint,
        tokenSymbol: position.tokenSymbol,
        confidence: 0.9,
        reason: `Stop loss threshold triggered: ${priceChangePct.toFixed(2)}% (stop: -${this.config.stopLossPct}%)`,
        timestamp: new Date(),
      };
    }

    return {
      action: 'HOLD',
      tokenMint: position.tokenMint,
      tokenSymbol: position.tokenSymbol,
      confidence: 0.5,
      reason: `Position within target bounds: ${priceChangePct.toFixed(2)}%`,
      timestamp: new Date(),
    };
  }
}

export const strategyService = new StrategyService();
