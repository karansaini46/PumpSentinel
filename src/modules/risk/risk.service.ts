import type {
  RiskAssessmentInput,
  RiskRuleConfig,
  RiskAssessmentResult,
  ComprehensiveRiskInput,
  TokenRiskReport,
} from './risk.types.js';
import { deterministicRiskEngine, DeterministicRiskEngine } from './deterministic-risk-engine.js';

export class RiskService {
  private config: RiskRuleConfig;
  private deterministicEngine: DeterministicRiskEngine;

  constructor(customConfig?: Partial<RiskRuleConfig>, customEngine?: DeterministicRiskEngine) {
    this.config = {
      maxTop10HoldingPct: customConfig?.maxTop10HoldingPct ?? 30.0,
      maxDevHoldingPct: customConfig?.maxDevHoldingPct ?? 10.0,
      minLiquiditySol: customConfig?.minLiquiditySol ?? 15.0,
      maxSniperCount: customConfig?.maxSniperCount ?? 3,
      requireSocials: customConfig?.requireSocials ?? false,
    };
    this.deterministicEngine = customEngine ?? deterministicRiskEngine;
  }

  /**
   * Evaluates all 10 deterministic risk categories with evidence, provenance,
   * configurable thresholds, and explainability.
   */
  public evaluateComprehensive(input: ComprehensiveRiskInput): TokenRiskReport {
    return this.deterministicEngine.evaluate(input);
  }

  public getDeterministicEngine(): DeterministicRiskEngine {
    return this.deterministicEngine;
  }

  public updateConfig(newConfig: Partial<RiskRuleConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public assess(input: RiskAssessmentInput): RiskAssessmentResult {
    let score = 0;
    const reasons: string[] = [];

    // Rule 1: Top 10 Holder Concentration
    if (input.top10HoldingPct > this.config.maxTop10HoldingPct) {
      score += 35;
      reasons.push(
        `Top 10 holders own ${input.top10HoldingPct}% (max allowed: ${this.config.maxTop10HoldingPct}%)`,
      );
    }

    // Rule 2: Dev Wallet Holding
    if (input.devHoldingPct > this.config.maxDevHoldingPct) {
      score += 35;
      reasons.push(
        `Developer wallet owns ${input.devHoldingPct}% (max allowed: ${this.config.maxDevHoldingPct}%)`,
      );
    }

    // Rule 3: Initial Liquidity
    if (input.liquiditySol < this.config.minLiquiditySol) {
      score += 25;
      reasons.push(
        `Liquidity is ${input.liquiditySol} SOL (min required: ${this.config.minLiquiditySol} SOL)`,
      );
    }

    // Rule 4: Snipers
    if (input.suspectedSniperCount > this.config.maxSniperCount) {
      score += 20;
      reasons.push(
        `Excessive snipers detected: ${input.suspectedSniperCount} (max: ${this.config.maxSniperCount})`,
      );
    }

    // Rule 5: Missing metadata or socials
    if (!input.hasValidMetadata) {
      score += 15;
      reasons.push('Token metadata URI could not be validated');
    }

    if (this.config.requireSocials && !input.hasSocials) {
      score += 15;
      reasons.push('Token has no social links');
    }

    const normalizedScore = Math.min(100, score);
    const passed = reasons.length === 0 && normalizedScore < 50;

    return {
      mint: input.mint,
      score: normalizedScore,
      passed,
      reasons,
      assessedAt: new Date(),
    };
  }
}

export const riskService = new RiskService();
