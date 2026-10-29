import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  RiskGateOutcome,
  RiskGateConfig,
  RiskGateDecision,
  RiskGateReasonCode,
  GateEvaluationInput,
  MaterialMarketChange,
  TokenRiskReport,
  RiskCategory,
} from './risk.types.js';
import { RiskGateInvariantViolationError } from './risk.types.js';
import { deterministicRiskEngine, DeterministicRiskEngine } from './deterministic-risk-engine.js';
import { logger } from '../observability/logger.js';

export const DEFAULT_RISK_GATE_CONFIG: RiskGateConfig = {
  creatorHoldingsThresholdPct: 10.0,
  suspectedBundleThresholdPct: 25.0,
  minLiquiditySol: 15.0,
  maxTop10ConcentrationPct: 30.0,
  maxSellPriceImpactPct: 20.0,
  requireRevokedMintAuthority: true,
  requireRevokedFreezeAuthority: true,
  minDataCompletenessPct: 75.0,
  maxDataAgeMs: 60_000, // 60 seconds
  decisionTtlMs: 300_000, // 5 minutes
  materialLiquidityDropPct: 10.0, // 10% drop triggers recheck
  materialLargeSellPct: 5.0, // 5% dump triggers recheck
  allowProbabilisticBundles: false,
};

export class RiskDecisionGate {
  private config: RiskGateConfig;
  private riskEngine: DeterministicRiskEngine;
  private activeDecisions = new Map<string, RiskGateDecision>();
  private decisionHistory = new Map<string, RiskGateDecision[]>();
  private decisionsById = new Map<string, RiskGateDecision>();
  private emitter = new EventEmitter();
  public readonly decisionVersion = '1.0.0';

  constructor(customConfig?: Partial<RiskGateConfig>, customEngine?: DeterministicRiskEngine) {
    this.config = { ...DEFAULT_RISK_GATE_CONFIG, ...customConfig };
    this.riskEngine = customEngine ?? deterministicRiskEngine;
  }

  public getConfig(): Readonly<RiskGateConfig> {
    return Object.freeze({ ...this.config });
  }

  public updateConfig(newConfig: Partial<RiskGateConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info({ config: this.config }, '[RiskDecisionGate] Configuration updated');
  }

  /**
   * Combines individual risk checks, freshness, evidence integrity, and configurable
   * thresholds into a final deterministic eligibility decision (Rules 1 - 10).
   */
  public evaluateGate(
    input: GateEvaluationInput,
    options?: { configOverrides?: Partial<RiskGateConfig> },
  ): RiskGateDecision {
    const config = { ...this.config, ...options?.configOverrides };
    const now = input.evaluatedAt ?? new Date();

    const reasons: string[] = [];
    const reasonCodes: RiskGateReasonCode[] = [];
    const criticalFails: string[] = [];
    const recheckReasons: string[] = [];
    const evidenceMetrics: Record<string, unknown> = {};

    // -------------------------------------------------------------------------
    // Rule 5: Conflicting evidence triggers rechecking
    // -------------------------------------------------------------------------
    const conflictingEvidence = this.detectConflictingEvidence(input, config);
    if (conflictingEvidence.length > 0) {
      for (const conflict of conflictingEvidence) {
        reasonCodes.push('RECHECK_CONFLICTING_EVIDENCE');
        reasons.push(`[Conflicting Evidence] ${conflict}`);
        recheckReasons.push(conflict);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 3: Stale critical data triggers rechecking
    // -------------------------------------------------------------------------
    const staleReasons = this.detectStaleCriticalData(input, config, now);
    if (staleReasons.length > 0) {
      for (const stale of staleReasons) {
        reasonCodes.push('RECHECK_STALE_CRITICAL_DATA');
        reasons.push(`[Stale Critical Data] ${stale}`);
        recheckReasons.push(stale);
      }
    }

    // -------------------------------------------------------------------------
    // Obtain or execute the deterministic TokenRiskReport
    // -------------------------------------------------------------------------
    let riskReport: TokenRiskReport;
    if (input.riskReport) {
      riskReport = input.riskReport;
    } else {
      // Evaluate deterministic engine with comprehensive or synthesized input
      const comprehensive = input.comprehensiveInput ?? {
        mint: input.mint,
        symbol: input.symbol,
        analysisReport: input.analysisReport,
        rawHolders: input.rawHolders,
        customLiquiditySol: input.customLiquiditySol,
        customCreatorHoldingPct: input.customCreatorHoldingPct,
        customTop10HoldingPct: input.customTop10HoldingPct,
      };
      riskReport = this.riskEngine.evaluate(comprehensive);
    }

    // Store check metrics in evidence
    evidenceMetrics['checks'] = riskReport.checks;
    evidenceMetrics['overallScore'] = riskReport.overallScore;
    evidenceMetrics['overallStatus'] = riskReport.overallStatus;

    // -------------------------------------------------------------------------
    // Rule 2: Missing critical evidence prevents eligibility
    // -------------------------------------------------------------------------
    const missingEvidence = this.detectMissingCriticalEvidence(input, riskReport, config);
    if (missingEvidence.length > 0) {
      for (const missing of missingEvidence) {
        reasonCodes.push('REJECT_MISSING_CRITICAL_EVIDENCE');
        reasons.push(`[Missing Critical Evidence] ${missing}`);
        criticalFails.push(missing);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 4: Insufficient liquidity rejects the token
    // -------------------------------------------------------------------------
    const liquiditySol =
      input.customLiquiditySol ??
      (riskReport.checks.LIQUIDITY_AND_EXIT.evidence.metrics['liquiditySol'] as
        number | undefined) ??
      (input.analysisReport?.liquidityAndDepth?.liquiditySol.value as number | undefined) ??
      0;

    evidenceMetrics['liquiditySol'] = liquiditySol;

    if (liquiditySol < config.minLiquiditySol) {
      const liqFail = `Liquidity is ${liquiditySol.toFixed(2)} SOL (minimum required: ${config.minLiquiditySol.toFixed(2)} SOL)`;
      reasonCodes.push('REJECT_INSUFFICIENT_LIQUIDITY');
      reasons.push(`[Insufficient Liquidity] ${liqFail}`);
      criticalFails.push(liqFail);
    }

    // -------------------------------------------------------------------------
    // Rule 1: Any critical FAIL rejects the token
    // -------------------------------------------------------------------------
    for (const [categoryKey, check] of Object.entries(riskReport.checks)) {
      const category = categoryKey as RiskCategory;
      if (check.status === 'FAIL') {
        const mappedCode = this.mapCategoryToRejectCode(category);
        if (!reasonCodes.includes(mappedCode)) {
          reasonCodes.push(mappedCode);
        }
        const failMsg = `[${category}] ${check.evidence.explanation}`;
        if (!reasons.includes(failMsg)) {
          reasons.push(failMsg);
        }
        if (!criticalFails.includes(failMsg)) {
          criticalFails.push(failMsg);
        }
      }
    }

    // Check for probabilistic bundle warnings when not explicitly allowed
    if (
      !config.allowProbabilisticBundles &&
      riskReport.checks.BUNDLED_PURCHASES.status === 'WARN' &&
      criticalFails.length === 0
    ) {
      const bundleWarn =
        'Probabilistic bundled purchases detected without cryptographic multi-account proof; requires verification before strategy entry.';
      reasonCodes.push('RECHECK_PROBABILISTIC_BUNDLE_UNCONFIRMED');
      reasons.push(`[Unverified Bundle] ${bundleWarn}`);
      recheckReasons.push(bundleWarn);
    }

    // Check for price & volume anomalies
    if (riskReport.checks.PRICE_AND_VOLUME.status === 'WARN' && criticalFails.length === 0) {
      const pWarn = 'Unusual price or volume anomaly observed; rechecking required.';
      reasonCodes.push('RECHECK_PRICE_VOLUME_ANOMALY');
      reasons.push(`[Price/Volume Anomaly] ${pWarn}`);
      recheckReasons.push(pWarn);
    }

    // -------------------------------------------------------------------------
    // Determine Final Gate Outcome
    // Rule 5: Conflicting evidence triggers rechecking
    // Rule 1: Any critical FAIL rejects the token
    // -------------------------------------------------------------------------
    let outcome: RiskGateOutcome;

    if (conflictingEvidence.length > 0) {
      // Rule 5: Conflicting evidence triggers rechecking
      outcome = 'NEEDS_RECHECK';
    } else if (criticalFails.length > 0) {
      outcome = 'REJECT';
    } else if (recheckReasons.length > 0) {
      outcome = 'NEEDS_RECHECK';
    } else {
      outcome = 'ELIGIBLE_FOR_STRATEGY';
      reasonCodes.push('GATE_ELIGIBLE');
      reasons.push('Token passed all deterministic risk criteria and meets strategy entry rules');
    }

    const decisionId = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + config.decisionTtlMs);

    // Rule 6 & 9: Record decision with reasons, evidence, and version
    const decision: RiskGateDecision = {
      decisionId,
      decisionVersion: this.decisionVersion,
      tokenMint: input.mint,
      tokenSymbol: input.symbol,
      outcome,
      passed: outcome === 'ELIGIBLE_FOR_STRATEGY',
      reasons,
      reasonCodes,
      criticalFails,
      recheckReasons,
      evidence: {
        ...evidenceMetrics,
        metrics: riskReport.checks,
        inputMint: input.mint,
        inputSymbol: input.symbol,
        evaluatedAt: now.toISOString(),
      },
      evaluatedAt: now,
      expiresAt,
      isExpired: false,
      materialChanges: [],
      configSnapshot: Object.freeze({ ...config }),
    };

    // Store in active cache, ID index, and audit history
    this.activeDecisions.set(input.mint, decision);
    this.decisionsById.set(decisionId, decision);

    const history = this.decisionHistory.get(input.mint) ?? [];
    history.push(decision);
    if (history.length > 50) {
      history.shift(); // ring buffer capped at 50 per token
    }
    this.decisionHistory.set(input.mint, history);

    logger.info(
      {
        decisionId,
        mint: decision.tokenMint,
        outcome: decision.outcome,
        passed: decision.passed,
        criticalFailsCount: criticalFails.length,
        recheckReasonsCount: recheckReasons.length,
      },
      '[RiskDecisionGate] Risk decision evaluated',
    );

    this.emitter.emit('decisionCreated', decision);
    return decision;
  }

  /**
   * Rule 10: Re-evaluate eligibility when material market changes occur.
   */
  public notifyMaterialMarketChange(change: MaterialMarketChange): RiskGateDecision {
    const existing = this.getLatestDecision(change.tokenMint);
    const now = change.detectedAt ?? new Date();

    // Deduplication: Ignore identical duplicate market change events
    if (
      existing?.materialChanges.some(
        (c) =>
          c.changeId === change.changeId ||
          (Boolean(change.signature) && Boolean(c.signature) && c.signature === change.signature),
      )
    ) {
      logger.info(
        { changeId: change.changeId, mint: change.tokenMint },
        '[RiskDecisionGate] Duplicate material market change event ignored',
      );
      return existing;
    }

    logger.warn(
      {
        mint: change.tokenMint,
        changeType: change.changeType,
        magnitudePct: change.magnitudePct,
        description: change.description,
      },
      '[RiskDecisionGate] Material market change detected',
    );

    let newOutcome: RiskGateOutcome = 'NEEDS_RECHECK';
    const reasonCodes: RiskGateReasonCode[] = ['RECHECK_MATERIAL_MARKET_CHANGE'];
    const reasons: string[] = [`[Material Change: ${change.changeType}] ${change.description}`];
    const criticalFails: string[] = [];
    const recheckReasons: string[] = [change.description];

    // Check if the change causes immediate catastrophic rejection
    if (
      change.changeType === 'LIQUIDITY_DROP' &&
      typeof change.newValue === 'number' &&
      change.newValue < this.config.minLiquiditySol
    ) {
      newOutcome = 'REJECT';
      reasonCodes.push('REJECT_INSUFFICIENT_LIQUIDITY', 'REJECT_CATASTROPHIC_MARKET_CHANGE');
      const failMsg = `Catastrophic liquidity drop to ${change.newValue} SOL (< ${this.config.minLiquiditySol} SOL min)`;
      reasons.push(`[Catastrophic Liquidity Drop] ${failMsg}`);
      criticalFails.push(failMsg);
    } else if (
      change.changeType === 'AUTHORITY_MUTATION' &&
      (change.newValue === false || change.newValue === 'active')
    ) {
      newOutcome = 'REJECT';
      reasonCodes.push('REJECT_AUTHORITY_NOT_REVOKED', 'REJECT_CATASTROPHIC_MARKET_CHANGE');
      const failMsg = `Authority mutation: Authority was re-enabled or modified unexpectedly`;
      reasons.push(`[Authority Revocation Breached] ${failMsg}`);
      criticalFails.push(failMsg);
    } else {
      newOutcome = 'NEEDS_RECHECK';
    }

    const previousChanges = existing?.materialChanges ?? [];
    const updatedChanges = [...previousChanges, change];

    const updatedDecision: RiskGateDecision = {
      decisionId: crypto.randomUUID(),
      decisionVersion: this.decisionVersion,
      tokenMint: change.tokenMint,
      tokenSymbol: existing?.tokenSymbol ?? 'UNKNOWN',
      outcome: newOutcome,
      passed: false,
      reasons,
      reasonCodes,
      criticalFails,
      recheckReasons,
      evidence: {
        ...(existing?.evidence ?? {}),
        lastMaterialChange: change,
      },
      evaluatedAt: now,
      expiresAt: new Date(now.getTime() + this.config.decisionTtlMs),
      isExpired: false,
      materialChanges: updatedChanges,
      configSnapshot: existing?.configSnapshot ?? Object.freeze({ ...this.config }),
    };

    this.activeDecisions.set(change.tokenMint, updatedDecision);
    this.decisionsById.set(updatedDecision.decisionId, updatedDecision);

    const history = this.decisionHistory.get(change.tokenMint) ?? [];
    history.push(updatedDecision);
    if (history.length > 50) history.shift();
    this.decisionHistory.set(change.tokenMint, history);

    this.emitter.emit('materialMarketChange', { change, decision: updatedDecision });
    this.emitter.emit('decisionUpdated', updatedDecision);

    return updatedDecision;
  }

  /**
   * Final Invariant:
   * No token can be purchased by the paper-trading engine unless
   * it has passed the required risk gate and the entry strategy.
   */
  public assertEligibleForPurchase(
    mint: string,
    providedDecision?: RiskGateDecision,
  ): RiskGateDecision {
    const decision = providedDecision ?? this.getLatestDecision(mint);

    if (!decision) {
      throw new RiskGateInvariantViolationError(
        `Invariant violation: Token ${mint} cannot be purchased without an evaluated risk gate decision.`,
        { mint, reason: 'NO_DECISION_RECORDED' },
      );
    }

    if (decision.isExpired || Date.now() > decision.expiresAt.getTime()) {
      throw new RiskGateInvariantViolationError(
        `Invariant violation: Token ${mint} risk gate decision expired at ${decision.expiresAt.toISOString()}.`,
        { mint, expiresAt: decision.expiresAt, reason: 'DECISION_EXPIRED' },
      );
    }

    if (decision.outcome !== 'ELIGIBLE_FOR_STRATEGY' || !decision.passed) {
      throw new RiskGateInvariantViolationError(
        `Invariant violation: Token ${mint} is NOT eligible for purchase (Outcome: ${decision.outcome}). Reasons: ${decision.reasons.join('; ')}`,
        {
          mint,
          outcome: decision.outcome,
          reasons: decision.reasons,
          criticalFails: decision.criticalFails,
        },
      );
    }

    return decision;
  }

  public getLatestDecision(mint: string): RiskGateDecision | undefined {
    const decision = this.activeDecisions.get(mint);
    if (!decision) return undefined;

    // Dynamically update expired status
    const isNowExpired = Date.now() > decision.expiresAt.getTime();
    if (isNowExpired && !decision.isExpired) {
      decision.isExpired = true;
    }
    return decision;
  }

  public getDecisionById(decisionId: string): RiskGateDecision | undefined {
    const decision = this.decisionsById.get(decisionId);
    if (decision && Date.now() > decision.expiresAt.getTime()) {
      decision.isExpired = true;
    }
    return decision;
  }

  public getDecisionHistory(mint: string): RiskGateDecision[] {
    return [...(this.decisionHistory.get(mint) ?? [])];
  }

  public getRecentRejections(limit = 10): RiskGateDecision[] {
    const rejections: RiskGateDecision[] = [];
    for (const d of this.activeDecisions.values()) {
      if (d.outcome === 'REJECT' || !d.passed) {
        rejections.push(d);
      }
    }
    return rejections.slice(0, limit);
  }

  public onDecisionCreated(handler: (decision: RiskGateDecision) => void): () => void {
    this.emitter.on('decisionCreated', handler);
    return () => this.emitter.off('decisionCreated', handler);
  }

  public onMaterialChange(
    handler: (data: { change: MaterialMarketChange; decision: RiskGateDecision }) => void,
  ): () => void {
    this.emitter.on('materialMarketChange', handler);
    return () => this.emitter.off('materialMarketChange', handler);
  }

  // ---------------------------------------------------------------------------
  // Internal Rule Helpers
  // ---------------------------------------------------------------------------

  private detectConflictingEvidence(input: GateEvaluationInput, _config: RiskGateConfig): string[] {
    const conflicts: string[] = [];

    // Check 1: Liquidity vs on-chain reserves contradiction
    const reportedLiq =
      input.customLiquiditySol ??
      (typeof input.analysisReport?.liquidityAndDepth?.liquiditySol.value === 'number'
        ? input.analysisReport.liquidityAndDepth.liquiditySol.value
        : null);

    const rawReserves = input.analysisReport?.liquidityAndDepth?.virtualSolReserves?.value ?? null;
    const solReserves = typeof rawReserves === 'number' ? rawReserves : null;

    if (reportedLiq !== null && reportedLiq >= 15 && solReserves !== null && solReserves === 0) {
      conflicts.push(`Reported liquidity is ${reportedLiq} SOL, but pool reserves show 0 SOL.`);
    } else if (reportedLiq !== null && solReserves !== null && reportedLiq > 0 && solReserves > 0) {
      const diffRatio = Math.abs(reportedLiq - solReserves) / Math.max(reportedLiq, solReserves);
      if (diffRatio > 0.6) {
        conflicts.push(
          `Severe contradiction between reported liquidity (${reportedLiq} SOL) and observed reserves (${solReserves} SOL).`,
        );
      }
    }

    // Check 2: Holder concentration mathematics contradiction (> 100%)
    const creatorPct =
      input.customCreatorHoldingPct ??
      (typeof input.analysisReport?.creatorHoldings.percentageOfSupply.value === 'number'
        ? input.analysisReport.creatorHoldings.percentageOfSupply.value
        : null);

    const top10Pct =
      input.customTop10HoldingPct ??
      (typeof input.analysisReport?.largestHolders.nonCurveTop10Percentage.value === 'number'
        ? input.analysisReport.largestHolders.nonCurveTop10Percentage.value
        : null);

    if (creatorPct !== null && creatorPct > 100) {
      conflicts.push(`Impossible creator holding percentage reported: ${creatorPct}% (> 100%).`);
    }

    if (top10Pct !== null && top10Pct > 100) {
      conflicts.push(`Impossible top 10 holding percentage reported: ${top10Pct}% (> 100%).`);
    }

    if (creatorPct !== null && top10Pct !== null && creatorPct + top10Pct > 105) {
      conflicts.push(
        `Impossible cumulative supply ownership: Creator (${creatorPct}%) + Top 10 (${top10Pct}%) = ${(creatorPct + top10Pct).toFixed(2)}% (> 100%).`,
      );
    }

    // Check 3: Token authority contradiction
    if (input.analysisReport?.authorities) {
      const isMintRevoked = input.analysisReport.authorities.isMintAuthorityRevoked.value;
      const mintAuthority = input.analysisReport.authorities.mintAuthority.value;

      if (
        isMintRevoked === true &&
        typeof mintAuthority === 'string' &&
        mintAuthority.length > 20 &&
        mintAuthority !== 'revoked'
      ) {
        conflicts.push(
          `Mint authority is reported revoked, but active public key is present (${mintAuthority}).`,
        );
      }

      const isFreezeRevoked = input.analysisReport.authorities.isFreezeAuthorityRevoked.value;
      const freezeAuthority = input.analysisReport.authorities.freezeAuthority.value;

      if (
        isFreezeRevoked === true &&
        typeof freezeAuthority === 'string' &&
        freezeAuthority.length > 20 &&
        freezeAuthority !== 'revoked'
      ) {
        conflicts.push(
          `Freeze authority is reported revoked, but active public key is present (${freezeAuthority}).`,
        );
      }
    }

    // Check 4: Raw holder accounts contradiction with reported creator holdings
    if (input.rawHolders && input.rawHolders.length > 0 && creatorPct !== null) {
      const creatorHolders = input.rawHolders.filter((h) => h.isCreator);
      const totalRaw = input.rawHolders.reduce((sum, h) => sum + h.balance, 0);
      const creatorRaw = creatorHolders.reduce((sum, h) => sum + h.balance, 0);
      if (totalRaw > 0) {
        const rawCreatorPct = (creatorRaw / totalRaw) * 100;
        if (Math.abs(rawCreatorPct - creatorPct) > 15) {
          conflicts.push(
            `Raw holder accounts indicate creator holds ${rawCreatorPct.toFixed(1)}%, contradicting reported ${creatorPct}%.`,
          );
        }
      }
    }

    return conflicts;
  }

  private detectStaleCriticalData(
    input: GateEvaluationInput,
    config: RiskGateConfig,
    now: Date,
  ): string[] {
    const stale: string[] = [];

    if (input.analysisReport) {
      const evalTimestamp = new Date(input.analysisReport.analyzedAt).getTime();
      const currentTimestamp = now.getTime();
      const ageMs = currentTimestamp - evalTimestamp;

      if (ageMs > config.maxDataAgeMs) {
        stale.push(
          `Analysis report timestamp is ${Math.round(ageMs / 1000)}s old (max allowable freshness is ${config.maxDataAgeMs / 1000}s).`,
        );
      }

      if (input.analysisReport.overallSummary.staleFieldCount > 0) {
        stale.push('Analysis report contains stale fields (staleFieldCount > 0).');
      }

      // Helper to check field freshness
      const isFieldStale = (field: unknown): boolean => {
        if (!field || typeof field !== 'object') return false;
        const f = field as { freshness?: string; dataFreshness?: string };
        return f.freshness === 'STALE' || f.dataFreshness === 'STALE';
      };

      // Check critical field freshness
      if (isFieldStale(input.analysisReport.liquidityAndDepth?.liquiditySol)) {
        stale.push('Liquidity data freshness is marked as STALE.');
      }
      if (isFieldStale(input.analysisReport.creatorHoldings?.percentageOfSupply)) {
        stale.push('Creator holdings data freshness is marked as STALE.');
      }
      if (isFieldStale(input.analysisReport.largestHolders?.nonCurveTop10Percentage)) {
        stale.push('Top 10 holder concentration data freshness is marked as STALE.');
      }
      if (isFieldStale(input.analysisReport.authorities?.isMintAuthorityRevoked)) {
        stale.push('Mint authority revocation data freshness is marked as STALE.');
      }
    }

    return stale;
  }

  private detectMissingCriticalEvidence(
    input: GateEvaluationInput,
    riskReport: TokenRiskReport,
    config: RiskGateConfig,
  ): string[] {
    const missing: string[] = [];

    // Check if entire analysis report is absent
    if (!input.analysisReport && !input.riskReport) {
      missing.push('No token analysis report or verified risk report provided.');
      return missing;
    }

    // Check overall data completeness percentage
    if (input.analysisReport) {
      const completeness = input.analysisReport.overallSummary.dataCompletenessPct;
      if (completeness < config.minDataCompletenessPct) {
        missing.push(
          `Data completeness is ${completeness}% (required: ${config.minDataCompletenessPct}%).`,
        );
      }
    }

    // Check critical categories where UNKNOWN cannot pass
    const checks = riskReport.checks;
    if (checks.CREATOR_CONCENTRATION.status === 'UNKNOWN') {
      missing.push('Creator token concentration is UNKNOWN.');
    }
    if (checks.LIQUIDITY_AND_EXIT.status === 'UNKNOWN') {
      missing.push('Exit liquidity and market depth are UNKNOWN.');
    }
    if (checks.TOKEN_AUTHORITIES.status === 'UNKNOWN') {
      missing.push('Token mint/freeze revocation status is UNKNOWN.');
    }
    if (checks.DATA_COMPLETENESS.status === 'UNKNOWN') {
      missing.push('Data completeness score is UNKNOWN.');
    }

    return missing;
  }

  private mapCategoryToRejectCode(category: RiskCategory): RiskGateReasonCode {
    switch (category) {
      case 'CREATOR_CONCENTRATION':
        return 'REJECT_CREATOR_CONCENTRATION_EXCEEDED';
      case 'TOP_HOLDERS_CONCENTRATION':
        return 'REJECT_TOP_HOLDERS_CONCENTRATION_EXCEEDED';
      case 'BUNDLED_PURCHASES':
        return 'REJECT_BUNDLED_PURCHASES_EXCEEDED';
      case 'CREATOR_BEHAVIOR':
        return 'REJECT_CREATOR_SUSPICIOUS_BEHAVIOR';
      case 'PREVIOUS_HARMFUL_LAUNCHES':
        return 'REJECT_PREVIOUS_HARMFUL_LAUNCHES';
      case 'LIQUIDITY_AND_EXIT':
        return 'REJECT_INSUFFICIENT_LIQUIDITY';
      case 'TOKEN_AUTHORITIES':
        return 'REJECT_AUTHORITY_NOT_REVOKED';
      case 'DATA_COMPLETENESS':
        return 'REJECT_MISSING_CRITICAL_EVIDENCE';
      default:
        return 'REJECT_CRITICAL_FAIL';
    }
  }
}

export const riskDecisionGate = new RiskDecisionGate();
