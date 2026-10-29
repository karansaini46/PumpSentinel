import { describe, it, expect, beforeEach } from 'vitest';
import { RiskDecisionGate } from '../../src/modules/risk/risk-decision-gate.js';
import { RiskGateInvariantViolationError } from '../../src/modules/risk/risk.types.js';
import { StrategyService } from '../../src/modules/strategy/strategy.service.js';
import { PaperExecutionEngine } from '../../src/modules/execution/paper-engine.service.js';
import type { TokenAnalysisReport } from '../../src/modules/analysis/analysis.types.js';
import type { DiscoveredToken } from '../../src/modules/discovery/discovery.types.js';

function createField<T>(val: T, freshness: 'FRESH' | 'STALE' = 'FRESH') {
  return {
    value: val,
    source: 'rpc',
    observedAt: new Date(),
    confidence: 'HIGH' as const,
    confidenceScore: 1.0,
    freshness,
    freshnessMs: 0,
    nature: 'DIRECT' as const,
    status: 'CONFIRMED' as const,
  };
}

function createPassingAnalysisReport(
  overrides?: Partial<TokenAnalysisReport>,
  analyzedAt: Date = new Date(),
): TokenAnalysisReport {
  return {
    mint: 'SafeMint11111111111111111111111111111111111',
    symbol: 'SAFE',
    analyzedAt,
    executionDurationMs: 45,
    isCacheHit: false,
    budgetUsed: { rpcRequestsUsed: 4, rpcBudgetLimit: 10, budgetExhausted: false },
    supply: {
      mint: createField('SafeMint11111111111111111111111111111111111'),
      supply: createField(1_000_000_000),
      rawSupply: createField('1000000000000000'),
      decimals: createField(6),
      isInitialized: createField(true),
    },
    creatorWallet: {
      address: createField('CreatorWallet11111111111111111111111111111'),
      solBalance: createField(8.5),
      exists: createField(true),
      accountType: createField('SYSTEM_ACCOUNT'),
    },
    holderDistribution: {
      totalHoldersCount: createField(45),
      top5PercentShare: createField(15.0),
      top10PercentShare: createField(22.0),
      top20PercentShare: createField(35.0),
      concentrationLevel: createField('LOW'),
      giniCoefficient: createField(0.35),
    },
    creatorHoldings: {
      creatorAddress: createField('CreatorWallet11111111111111111111111111111'),
      tokenBalance: createField(40_000_000),
      percentageOfSupply: createField(4.0), // 4% <= 10%
      hasSoldTokens: createField(false),
      holdingStatus: createField('HOLDING' as const),
    },
    largestHolders: {
      nonCurveTop10Percentage: createField(18.0), // 18% <= 30%
      bondingCurvePercentage: createField(60.0),
      hasHighConcentration: createField(false),
      observedAccountsCount: createField(44),
      topHolders: createField([
        {
          address: 'Holder11111111111111111111111111111111111',
          balance: 20_000_000,
          percentage: 2.0,
          isBondingCurve: false,
          isCreator: false,
        },
      ]),
    },
    recentActivity: {
      buyCount: createField(25),
      sellCount: createField(10),
      buyVolumeSol: createField(15.0),
      sellVolumeSol: createField(5.0),
      netFlowSol: createField(10.0),
      recentTrades: createField([]),
      observationWindowSeconds: createField(300),
      totalTransactions: createField(35),
    },
    liquidityAndDepth: {
      liquiditySol: createField(30.0), // 30 SOL >= 15 SOL
      tokenReserves: createField(700_000_000),
      virtualSolReserves: createField(30.0),
      virtualTokenReserves: createField(1_073_000_000),
      currentPriceSol: createField(0.00003),
      marketDepth: createField([
        { orderSolAmount: 1.0, estimatedPriceImpactPct: 3.4, estimatedTokensOut: 30000 },
      ]),
      bondingCurveProgressPct: createField(15.0),
    },
    volume: {
      totalVolumeSol: createField(45.0),
      buyVolumeSol: createField(35.0),
      sellVolumeSol: createField(10.0),
      tradeCount: createField(35),
      windowSeconds: createField(300),
    },
    authorities: {
      isMintAuthorityRevoked: createField(true),
      isFreezeAuthorityRevoked: createField(true),
      mintAuthority: createField(null),
      freezeAuthority: createField(null),
      updateAuthority: createField(null),
    },
    relatedWallets: {
      linkedWallets: createField([]),
      connectedWalletCount: createField(0),
      dismissedNonEvidenceLinks: createField([]),
      hasSybilCluster: createField(false),
    },
    creatorHistory: {
      totalPastTokensLaunched: createField(1),
      pastTokens: createField([]),
      walletAgeDays: createField(10),
      firstSeenSlot: createField(100),
      rugPullCount: createField(0),
      reputationTier: createField('ESTABLISHED_SAFE'),
      reputationRiskScore: createField(0),
    },
    overallSummary: {
      dataCompletenessPct: 95.0,
      confidenceWeightedScore: 0.95,
      staleFieldCount: 0,
      contradictoryFieldCount: 0,
      unknownFieldCount: 0,
    },
    ...overrides,
  };
}

const mockToken: DiscoveredToken = {
  mint: 'SafeMint11111111111111111111111111111111111',
  name: 'SafeToken',
  symbol: 'SAFE',
  uri: 'https://example.com/token.json',
  creator: 'CreatorWallet11111111111111111111111111111',
  initialLiquiditySol: 30.0,
  bondingCurveProgress: 0.1,
  discoveredAt: new Date(),
  signature: 'mock_sig_1',
  slot: 123456,
  onChainTimestamp: new Date(),
  discoveryLatencyMs: 45,
  source: 'onchain',
  isSynthetic: false,
  lifecycleState: 'ELIGIBLE_FOR_RISK_ANALYSIS',
  metadataStatus: 'RESOLVED',
};

describe('Central Risk-Decision Gate (Rules 1 - 10)', () => {
  let gate: RiskDecisionGate;

  beforeEach(() => {
    gate = new RiskDecisionGate();
  });

  describe('Clean Passing Scenario', () => {
    it('returns ELIGIBLE_FOR_STRATEGY when all criteria pass cleanly', () => {
      const report = createPassingAnalysisReport();
      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'SAFE',
        analysisReport: report,
        customLiquiditySol: 30.0,
      });

      expect(decision.outcome).toBe('ELIGIBLE_FOR_STRATEGY');
      expect(decision.passed).toBe(true);
      expect(decision.decisionVersion).toBe('1.0.0');
      expect(decision.decisionId).toBeDefined();
      expect(decision.criticalFails).toHaveLength(0);
      expect(decision.recheckReasons).toHaveLength(0);
      expect(decision.reasonCodes).toContain('GATE_ELIGIBLE');
    });
  });

  describe('Rule 1: Any critical FAIL rejects the token', () => {
    it('rejects if creator holdings exceed limit (10.0%)', () => {
      const report = createPassingAnalysisReport();
      report.creatorHoldings.percentageOfSupply = createField(12.5); // 12.5% > 10%

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'GREED',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('REJECT_CREATOR_CONCENTRATION_EXCEEDED');
      expect(decision.criticalFails.length).toBeGreaterThan(0);
    });

    it('rejects if mint authority is not revoked', () => {
      const report = createPassingAnalysisReport();
      report.authorities.isMintAuthorityRevoked = createField(false);
      report.authorities.mintAuthority = createField('ActivePubkey111111111111111111111111111');

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'HONEY',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('REJECT_AUTHORITY_NOT_REVOKED');
    });

    it('rejects if bundled purchases exceed limit (25.0%)', () => {
      const report = createPassingAnalysisReport();

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'BUNDLE',
        analysisReport: report,
        comprehensiveInput: {
          mint: report.mint,
          symbol: 'BUNDLE',
          analysisReport: report,
          customBundledSupplyPct: 32.0,
          isBundleVerified: true,
        },
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('REJECT_BUNDLED_PURCHASES_EXCEEDED');
    });

    it('rejects if creator has confirmed rug pull history', () => {
      const report = createPassingAnalysisReport();
      report.creatorHistory.rugPullCount = createField(2);

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'RUGGER',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('REJECT_PREVIOUS_HARMFUL_LAUNCHES');
    });
  });

  describe('Rule 2: Missing critical evidence prevents eligibility', () => {
    it('rejects when no analysis report is provided', () => {
      const decision = gate.evaluateGate({
        mint: 'MissingReportMint1111111111111111111111111',
        symbol: 'NO_DATA',
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('REJECT_MISSING_CRITICAL_EVIDENCE');
    });

    it('rejects when data completeness is below configured threshold (75%)', () => {
      const report = createPassingAnalysisReport();
      report.overallSummary.dataCompletenessPct = 60.0; // 60% < 75%

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'PARTIAL',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('REJECT_MISSING_CRITICAL_EVIDENCE');
      expect(decision.criticalFails.some((f) => f.includes('completeness'))).toBe(true);
    });
  });

  describe('Rule 3: Stale critical data triggers rechecking', () => {
    it('triggers NEEDS_RECHECK if analysis report timestamp is older than maxDataAgeMs (60s)', () => {
      const staleTime = new Date(Date.now() - 75_000); // 75s ago
      const report = createPassingAnalysisReport({}, staleTime);

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'STALE',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('NEEDS_RECHECK');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('RECHECK_STALE_CRITICAL_DATA');
      expect(decision.recheckReasons.some((r) => r.includes('old'))).toBe(true);
    });

    it('triggers NEEDS_RECHECK if critical liquidity field is marked STALE', () => {
      const report = createPassingAnalysisReport();
      report.liquidityAndDepth.liquiditySol = createField(30.0, 'STALE');

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'STALELIQ',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('NEEDS_RECHECK');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('RECHECK_STALE_CRITICAL_DATA');
    });

    it('triggers NEEDS_RECHECK if overallSummary is marked isStale: true', () => {
      const report = createPassingAnalysisReport();
      report.overallSummary.staleFieldCount = 2;

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'STALEALL',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('NEEDS_RECHECK');
      expect(decision.reasonCodes).toContain('RECHECK_STALE_CRITICAL_DATA');
    });
  });

  describe('Rule 4: Insufficient liquidity rejects the token', () => {
    it('rejects if liquidity is below configured minLiquiditySol (15 SOL)', () => {
      const report = createPassingAnalysisReport();
      report.liquidityAndDepth.liquiditySol = createField(14.99); // 14.99 < 15.00 SOL
      report.liquidityAndDepth.virtualSolReserves = createField(14.99);

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'LOWLIQ',
        analysisReport: report,
        customLiquiditySol: 14.99,
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.passed).toBe(false);
      expect(decision.reasonCodes).toContain('REJECT_INSUFFICIENT_LIQUIDITY');
      expect(decision.criticalFails.some((f) => f.includes('minimum required'))).toBe(true);
    });

    it('passes liquidity check if exactly 15.00 SOL', () => {
      const report = createPassingAnalysisReport();
      report.liquidityAndDepth.liquiditySol = createField(15.0);
      report.liquidityAndDepth.virtualSolReserves = createField(15.0);

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'EXACTLIQ',
        analysisReport: report,
        customLiquiditySol: 15.0,
      });

      expect(decision.reasonCodes).not.toContain('REJECT_INSUFFICIENT_LIQUIDITY');
      expect(decision.outcome).toBe('ELIGIBLE_FOR_STRATEGY');
    });
  });

  describe('Rule 5: Conflicting evidence triggers rechecking', () => {
    it('triggers NEEDS_RECHECK if reported liquidity is high but on-chain pool reserves show 0 SOL', () => {
      const report = createPassingAnalysisReport();
      report.liquidityAndDepth.liquiditySol = createField(35.0);
      report.liquidityAndDepth.virtualSolReserves = createField(0); // 0 reserves contradiction

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'GHOST',
        analysisReport: report,
        customLiquiditySol: 35.0,
      });

      expect(decision.outcome).toBe('NEEDS_RECHECK');
      expect(decision.reasonCodes).toContain('RECHECK_CONFLICTING_EVIDENCE');
      expect(decision.recheckReasons.some((r) => r.includes('pool reserves show 0'))).toBe(true);
    });

    it('triggers NEEDS_RECHECK if holder percentages mathematically contradict (> 105%)', () => {
      const report = createPassingAnalysisReport();
      report.creatorHoldings.percentageOfSupply = createField(8.0);
      report.largestHolders.nonCurveTop10Percentage = createField(99.0); // 8% + 99% = 107% > 105%

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'PARADOX',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('NEEDS_RECHECK');
      expect(decision.reasonCodes).toContain('RECHECK_CONFLICTING_EVIDENCE');
    });

    it('triggers NEEDS_RECHECK if mint authority is flagged revoked but active pubkey is provided', () => {
      const report = createPassingAnalysisReport();
      report.authorities.isMintAuthorityRevoked = createField(true);
      report.authorities.mintAuthority = createField('SomeActivePublicKey111111111111111111111111');

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'MINTCONF',
        analysisReport: report,
      });

      expect(decision.outcome).toBe('NEEDS_RECHECK');
      expect(decision.reasonCodes).toContain('RECHECK_CONFLICTING_EVIDENCE');
    });

    it('triggers NEEDS_RECHECK if raw holder aggregation conflicts with reported creator holding (>15% diff)', () => {
      const report = createPassingAnalysisReport();
      report.creatorHoldings.percentageOfSupply = createField(5.0);

      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'DISCREP',
        analysisReport: report,
        rawHolders: [
          {
            ownerAddress: 'CreatorWallet11111111111111111111111111111',
            balance: 350_000_000,
            isCreator: true,
          },
          {
            ownerAddress: 'OtherHolder11111111111111111111111111111',
            balance: 650_000_000,
            isCreator: false,
          },
        ], // Creator raw is 35%, reported is 5%
      });

      expect(decision.outcome).toBe('NEEDS_RECHECK');
      expect(decision.reasonCodes).toContain('RECHECK_CONFLICTING_EVIDENCE');
    });
  });

  describe('Rule 6: Every decision records reasons, reason codes, and evidence', () => {
    it('attaches comprehensive evidence, reason codes, and config snapshot', () => {
      const report = createPassingAnalysisReport();
      const decision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'SAFE',
        analysisReport: report,
      });

      expect(decision.decisionId).toMatch(/^[0-9a-f-]+$/);
      expect(decision.evaluatedAt).toBeInstanceOf(Date);
      expect(decision.expiresAt).toBeInstanceOf(Date);
      expect(decision.evidence).toBeDefined();
      expect(decision.evidence['metrics']).toBeDefined();
      expect(decision.configSnapshot).toBeDefined();
      expect(decision.configSnapshot.minLiquiditySol).toBe(15.0);
    });
  });

  describe('Rule 7: Strategy cannot override a risk rejection', () => {
    it('strategy returns HOLD when risk gate rejects token, even if autoTrade is enabled', () => {
      const strategy = new StrategyService({ autoTradeEnabled: true, fixedBuyAmountSol: 1.0 });

      const report = createPassingAnalysisReport();
      report.creatorHoldings.percentageOfSupply = createField(15.0); // Fail

      const gateDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'REJ',
        analysisReport: report,
      });

      expect(gateDecision.outcome).toBe('REJECT');

      // Attempt to force strategy entry
      const signal = strategy.evaluateEntry(mockToken, gateDecision, 0);

      expect(signal.action).toBe('HOLD');
      expect(signal.confidence).toBe(0);
      expect(signal.reason).toContain("Risk gate outcome 'REJECT' prevents strategy entry");
    });

    it('strategy returns HOLD when risk gate outcome is NEEDS_RECHECK', () => {
      const strategy = new StrategyService({ autoTradeEnabled: true });
      const staleTime = new Date(Date.now() - 90_000);
      const report = createPassingAnalysisReport({}, staleTime);

      const gateDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'RECHECK',
        analysisReport: report,
      });

      expect(gateDecision.outcome).toBe('NEEDS_RECHECK');

      const signal = strategy.evaluateEntry(mockToken, gateDecision, 0);

      expect(signal.action).toBe('HOLD');
      expect(signal.reason).toContain("Risk gate outcome 'NEEDS_RECHECK'");
    });
  });

  describe('Rule 8: Risk thresholds are configurable', () => {
    it('applies updated configuration dynamically', () => {
      const customGate = new RiskDecisionGate({ minLiquiditySol: 50.0 });
      const report = createPassingAnalysisReport(); // Has 30 SOL

      const decision = customGate.evaluateGate({
        mint: report.mint,
        symbol: 'CUSTOM',
        analysisReport: report,
        customLiquiditySol: 30.0,
      });

      expect(decision.outcome).toBe('REJECT');
      expect(decision.reasonCodes).toContain('REJECT_INSUFFICIENT_LIQUIDITY');

      // Update config back to 20 SOL
      customGate.updateConfig({ minLiquiditySol: 20.0 });
      const updatedDecision = customGate.evaluateGate({
        mint: report.mint,
        symbol: 'CUSTOM',
        analysisReport: report,
        customLiquiditySol: 30.0,
      });

      expect(updatedDecision.outcome).toBe('ELIGIBLE_FOR_STRATEGY');
    });
  });

  describe('Rule 9: Decisions are versioned for later analysis', () => {
    it('records version and maintains audit history per mint', () => {
      const report = createPassingAnalysisReport();
      const dec1 = gate.evaluateGate({ mint: report.mint, symbol: 'SAFE', analysisReport: report });

      report.creatorHoldings.percentageOfSupply = createField(15.0);
      const dec2 = gate.evaluateGate({ mint: report.mint, symbol: 'SAFE', analysisReport: report });

      expect(dec1.decisionVersion).toBe('1.0.0');
      expect(dec2.decisionVersion).toBe('1.0.0');
      expect(dec1.decisionId).not.toBe(dec2.decisionId);

      const history = gate.getDecisionHistory(report.mint);
      expect(history).toHaveLength(2);
      expect(history[0]!.outcome).toBe('ELIGIBLE_FOR_STRATEGY');
      expect(history[1]!.outcome).toBe('REJECT');
    });
  });

  describe('Rule 10: Re-evaluate eligibility when material market changes occur', () => {
    it('demotes ELIGIBLE token to NEEDS_RECHECK on material liquidity drop (>=10%)', () => {
      const report = createPassingAnalysisReport();
      const initialDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'SAFE',
        analysisReport: report,
        customLiquiditySol: 30.0,
      });

      expect(initialDecision.outcome).toBe('ELIGIBLE_FOR_STRATEGY');

      // Material liquidity drop of 15% (30 -> 25.5 SOL)
      const updated = gate.notifyMaterialMarketChange({
        changeId: 'change_1',
        tokenMint: report.mint,
        changeType: 'LIQUIDITY_DROP',
        magnitudePct: 15.0,
        previousValue: 30.0,
        newValue: 25.5,
        detectedAt: new Date(),
        description: 'Liquidity dropped by 15.0% in rapid sell block',
      });

      expect(updated.outcome).toBe('NEEDS_RECHECK');
      expect(updated.passed).toBe(false);
      expect(updated.reasonCodes).toContain('RECHECK_MATERIAL_MARKET_CHANGE');
      expect(updated.materialChanges).toHaveLength(1);
    });

    it('immediately REJECTS token if material change breaches minimum liquidity threshold', () => {
      const report = createPassingAnalysisReport();
      gate.evaluateGate({
        mint: report.mint,
        symbol: 'SAFE',
        analysisReport: report,
        customLiquiditySol: 30.0,
      });

      // Catastrophic rug drop: 30 SOL -> 4 SOL
      const updated = gate.notifyMaterialMarketChange({
        changeId: 'change_catastrophic',
        tokenMint: report.mint,
        changeType: 'LIQUIDITY_DROP',
        magnitudePct: 86.6,
        previousValue: 30.0,
        newValue: 4.0,
        detectedAt: new Date(),
        description: 'Massive liquidity drain to 4.0 SOL',
      });

      expect(updated.outcome).toBe('REJECT');
      expect(updated.passed).toBe(false);
      expect(updated.reasonCodes).toContain('REJECT_INSUFFICIENT_LIQUIDITY');
      expect(updated.reasonCodes).toContain('REJECT_CATASTROPHIC_MARKET_CHANGE');
    });
  });

  describe('Final Invariant: Paper Trading Engine Enforcement & Adversarial Bypass Tests', () => {
    let engine: PaperExecutionEngine;

    beforeEach(() => {
      engine = new PaperExecutionEngine();
    });

    it('ADVERSARIAL: Throws RiskGateInvariantViolationError when buying with no risk decision', () => {
      expect(() => {
        engine.executeSimulatedOrder({
          tokenMint: 'UncheckedMint11111111111111111111111111111',
          tokenSymbol: 'ROGUE',
          side: 'BUY',
          solAmount: 1.0,
          currentPriceSol: 0.001,
          reason: 'Attempting stealth buy without gate',
        });
      }).toThrow(RiskGateInvariantViolationError);
    });

    it('ADVERSARIAL: Throws RiskGateInvariantViolationError when buying a REJECTED token', () => {
      const report = createPassingAnalysisReport();
      report.creatorHoldings.percentageOfSupply = createField(20.0); // REJECT

      const rejectedDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'REJ',
        analysisReport: report,
      });

      expect(() => {
        engine.executeSimulatedOrder({
          tokenMint: report.mint,
          tokenSymbol: 'REJ',
          side: 'BUY',
          solAmount: 1.0,
          currentPriceSol: 0.001,
          reason: 'Bypass attempt with rejected token',
          riskDecision: rejectedDecision,
          strategySignal: {
            action: 'BUY',
            tokenMint: report.mint,
            tokenSymbol: 'REJ',
            confidence: 0.9,
            reason: 'Rogue strategy trying to buy rejected coin',
            timestamp: new Date(),
          },
        });
      }).toThrow(/Invariant violation: Token .* is NOT eligible for purchase \(Outcome: REJECT\)/);
    });

    it('ADVERSARIAL: Throws RiskGateInvariantViolationError when buying a NEEDS_RECHECK token', () => {
      const staleTime = new Date(Date.now() - 80_000);
      const report = createPassingAnalysisReport({}, staleTime);

      const recheckDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'STALE',
        analysisReport: report,
      });

      expect(() => {
        engine.executeSimulatedOrder({
          tokenMint: report.mint,
          tokenSymbol: 'STALE',
          side: 'BUY',
          solAmount: 0.5,
          currentPriceSol: 0.001,
          reason: 'Bypass attempt on stale data',
          riskDecision: recheckDecision,
          strategySignal: {
            action: 'BUY',
            tokenMint: report.mint,
            tokenSymbol: 'STALE',
            confidence: 0.8,
            reason: 'Strategy BUY',
            timestamp: new Date(),
          },
        });
      }).toThrow(/Outcome: NEEDS_RECHECK/);
    });

    it('ADVERSARIAL: Throws RiskGateInvariantViolationError when buying with an expired decision', () => {
      const report = createPassingAnalysisReport();
      const pastTime = new Date(Date.now() - 400_000); // 400s ago (> 300s TTL)

      const expiredDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'EXPIRED',
        analysisReport: report,
        evaluatedAt: pastTime,
      });

      expect(() => {
        engine.executeSimulatedOrder({
          tokenMint: report.mint,
          tokenSymbol: 'EXPIRED',
          side: 'BUY',
          solAmount: 0.5,
          currentPriceSol: 0.001,
          reason: 'Bypass attempt with expired gate pass',
          riskDecision: expiredDecision,
          strategySignal: {
            action: 'BUY',
            tokenMint: report.mint,
            tokenSymbol: 'EXPIRED',
            confidence: 0.9,
            reason: 'Strategy BUY',
            timestamp: new Date(),
          },
        });
      }).toThrow(/decision expired/);
    });

    it('ADVERSARIAL: Throws RiskGateInvariantViolationError when strategy signal action is HOLD', () => {
      const report = createPassingAnalysisReport();
      const validDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'SAFE',
        analysisReport: report,
      });

      expect(() => {
        engine.executeSimulatedOrder({
          tokenMint: report.mint,
          tokenSymbol: 'SAFE',
          side: 'BUY',
          solAmount: 0.5,
          currentPriceSol: 0.001,
          reason: 'Bypass attempt with strategy HOLD',
          riskDecision: validDecision,
          strategySignal: {
            action: 'HOLD',
            tokenMint: report.mint,
            tokenSymbol: 'SAFE',
            confidence: 0.2,
            reason: 'Strategy says HOLD',
            timestamp: new Date(),
          },
        });
      }).toThrow(/Order must be approved by entry strategy with action 'BUY'/);
    });

    it('ADVERSARIAL: Throws RiskGateInvariantViolationError when strategy signal is completely omitted', () => {
      const report = createPassingAnalysisReport();
      const validDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'SAFE',
        analysisReport: report,
      });

      expect(() => {
        engine.executeSimulatedOrder({
          tokenMint: report.mint,
          tokenSymbol: 'SAFE',
          side: 'BUY',
          solAmount: 0.5,
          currentPriceSol: 0.001,
          reason: 'Bypass attempt without strategy approval',
          riskDecision: validDecision,
        });
      }).toThrow(/Order must be approved by entry strategy with action 'BUY'/);
    });

    it('SUCCESS: Executes paper BUY order when both Risk Gate and Strategy pass', () => {
      const report = createPassingAnalysisReport();
      const validDecision = gate.evaluateGate({
        mint: report.mint,
        symbol: 'SAFE',
        analysisReport: report,
      });

      const trade = engine.executeSimulatedOrder({
        tokenMint: report.mint,
        tokenSymbol: 'SAFE',
        side: 'BUY',
        solAmount: 0.5,
        currentPriceSol: 0.0001,
        reason: 'Authorized paper trade',
        riskDecision: validDecision,
        strategySignal: {
          action: 'BUY',
          tokenMint: report.mint,
          tokenSymbol: 'SAFE',
          confidence: 0.85,
          reason: 'Passed risk gate & strategy criteria',
          timestamp: new Date(),
        },
      });

      expect(trade.isSimulated).toBe(true);
      expect(trade.side).toBe('BUY');
      expect(trade.totalSol).toBe(0.5);
      expect(trade.amountTokens).toBeGreaterThan(0);
    });

    it('SELL orders execute without requiring risk gate (allowing safe risk-off exit)', () => {
      const trade = engine.executeSimulatedOrder({
        tokenMint: 'AnyToken11111111111111111111111111111111111',
        tokenSymbol: 'EXIT',
        side: 'SELL',
        tokenAmount: 1000,
        currentPriceSol: 0.0005,
        reason: 'Stop loss exit',
      });

      expect(trade.side).toBe('SELL');
      expect(trade.amountTokens).toBe(1000);
      expect(trade.isSimulated).toBe(true);
    });
  });
});
