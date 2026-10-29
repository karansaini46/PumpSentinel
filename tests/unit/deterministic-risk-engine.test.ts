import { describe, it, expect } from 'vitest';
import {
  DeterministicRiskEngine,
  type ComprehensiveRiskInput,
  type RiskReasonCode,
} from '../../src/modules/risk/index.js';
import type { TokenAnalysisReport } from '../../src/modules/analysis/analysis.types.js';

describe('Deterministic Risk Engine Module', () => {
  const engine = new DeterministicRiskEngine();

  // Helper to build a baseline passing TokenAnalysisReport
  const createPassingAnalysisReport = (): TokenAnalysisReport => {
    return {
      mint: 'PassMint11111111111111111111111111111111111',
      symbol: 'PASS',
      analyzedAt: new Date(),
      executionDurationMs: 120,
      isCacheHit: false,
      budgetUsed: { rpcRequestsUsed: 4, rpcBudgetLimit: 10, budgetExhausted: false },
      supply: {
        mint: {
          value: 'PassMint11111111111111111111111111111111111',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        supply: {
          value: 1_000_000_000,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        rawSupply: {
          value: '1000000000000000',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        decimals: {
          value: 6,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        isInitialized: {
          value: true,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      creatorWallet: {
        address: {
          value: 'CreatorWallet11111111111111111111111111111',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        solBalance: {
          value: 8.5,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        exists: {
          value: true,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        accountType: {
          value: 'SYSTEM_ACCOUNT',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      holderDistribution: {
        totalHoldersCount: {
          value: 45,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        top5PercentShare: {
          value: 15.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        top10PercentShare: {
          value: 22.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        top20PercentShare: {
          value: 35.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        concentrationLevel: {
          value: 'LOW',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        giniCoefficient: {
          value: 0.35,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      creatorHoldings: {
        creatorAddress: {
          value: 'CreatorWallet11111111111111111111111111111',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        tokenBalance: {
          value: 40_000_000,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        percentageOfSupply: {
          value: 4.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        hasSoldTokens: {
          value: false,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        holdingStatus: {
          value: 'HOLDING',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      largestHolders: {
        topHolders: {
          value: [],
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        nonCurveTop10Percentage: {
          value: 18.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        bondingCurvePercentage: {
          value: 80.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        hasHighConcentration: {
          value: false,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        observedAccountsCount: {
          value: 10,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      recentActivity: {
        observationWindowSeconds: {
          value: 1800,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        totalTransactions: {
          value: 40,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        buyVolumeSol: {
          value: 20.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        sellVolumeSol: {
          value: 5.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        netFlowSol: {
          value: 15.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        buyCount: {
          value: 30,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        sellCount: {
          value: 10,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        recentTrades: {
          value: [],
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      liquidityAndDepth: {
        liquiditySol: {
          value: 25.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        virtualSolReserves: {
          value: 30.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        virtualTokenReserves: {
          value: 800_000_000,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        tokenReserves: {
          value: 800_000_000,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        currentPriceSol: {
          value: 0.00000003,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        marketDepth: {
          value: [
            {
              orderSolAmount: 1.0,
              estimatedTokensOut: 30000000,
              estimatedPriceImpactPct: 3.5,
            },
          ],
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        bondingCurveProgressPct: {
          value: 28.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      volume: {
        totalVolumeSol: {
          value: 25.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        buyVolumeSol: {
          value: 20.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        sellVolumeSol: {
          value: 5.0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        tradeCount: {
          value: 40,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        windowSeconds: {
          value: 3600,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      authorities: {
        mintAuthority: {
          value: null,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        freezeAuthority: {
          value: null,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        isMintAuthorityRevoked: {
          value: true,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        isFreezeAuthorityRevoked: {
          value: true,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        updateAuthority: {
          value: null,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      relatedWallets: {
        linkedWallets: {
          value: [],
          source: 'evidence',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        connectedWalletCount: {
          value: 0,
          source: 'evidence',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        dismissedNonEvidenceLinks: {
          value: [],
          source: 'evidence',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        hasSybilCluster: {
          value: false,
          source: 'evidence',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      creatorHistory: {
        totalPastTokensLaunched: {
          value: 1,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        pastTokens: {
          value: [],
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        walletAgeDays: {
          value: 45,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        firstSeenSlot: {
          value: 270000,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        rugPullCount: {
          value: 0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        reputationTier: {
          value: 'ESTABLISHED_SAFE',
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
        reputationRiskScore: {
          value: 0,
          source: 'rpc',
          observedAt: new Date(),
          confidence: 'HIGH',
          confidenceScore: 1,
          freshness: 'FRESH',
          freshnessMs: 0,
          nature: 'DIRECT',
          status: 'CONFIRMED',
        },
      },
      overallSummary: {
        dataCompletenessPct: 100,
        confidenceWeightedScore: 1.0,
        staleFieldCount: 0,
        contradictoryFieldCount: 0,
        unknownFieldCount: 0,
      },
    };
  };

  describe('Threshold Boundary and Precision Checks', () => {
    it('accepts creator holdings at exactly 10.0% boundary and rejects at 10.001%', () => {
      const passingInput: ComprehensiveRiskInput = {
        mint: 'BoundaryMint1',
        symbol: 'BOUND1',
        customCreatorHoldingPct: 10.0,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      };
      const passReport = engine.evaluate(passingInput);
      const creatorCheckPass = passReport.checks.CREATOR_CONCENTRATION;

      expect(creatorCheckPass.status).toBe('PASS');
      expect(creatorCheckPass.reasonCode).toBe<RiskReasonCode>('CREATOR_CONCENTRATION_PASS');
      expect(creatorCheckPass.evidence.metrics['creatorHoldingPct']).toBe(10.0);

      // 10.001% exceeds 10.0% threshold -> FAIL
      const failingInput: ComprehensiveRiskInput = {
        ...passingInput,
        customCreatorHoldingPct: 10.001,
      };
      const failReport = engine.evaluate(failingInput);
      const creatorCheckFail = failReport.checks.CREATOR_CONCENTRATION;

      expect(creatorCheckFail.status).toBe('FAIL');
      expect(creatorCheckFail.reasonCode).toBe<RiskReasonCode>(
        'CREATOR_CONCENTRATION_EXCEEDS_LIMIT',
      );
      expect(failReport.passed).toBe(false);
      expect(failReport.criticalFlags.some((f) => f.includes('exceeding max threshold'))).toBe(
        true,
      );
    });

    it('handles floating-point rounding gracefully for 9.9999% vs 10.0001%', () => {
      const underInput: ComprehensiveRiskInput = {
        mint: 'PrecisionMint1',
        symbol: 'PREC1',
        customCreatorHoldingPct: 9.9999,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      };
      const overInput: ComprehensiveRiskInput = {
        mint: 'PrecisionMint2',
        symbol: 'PREC2',
        customCreatorHoldingPct: 10.0001,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      };

      const underReport = engine.evaluate(underInput);
      const overReport = engine.evaluate(overInput);

      expect(underReport.checks.CREATOR_CONCENTRATION.status).toBe('PASS');
      expect(overReport.checks.CREATOR_CONCENTRATION.status).toBe('FAIL');
    });

    it('rejects suspected bundled purchases above 25% boundary', () => {
      const inputAt25: ComprehensiveRiskInput = {
        mint: 'BundleMint1',
        symbol: 'BNDL1',
        customBundledSupplyPct: 25.0,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      };
      const report25 = engine.evaluate(inputAt25);
      expect(report25.checks.BUNDLED_PURCHASES.status).toBe('WARN'); // >10% triggers warn, but <=25% does not fail

      const inputAt25Point01: ComprehensiveRiskInput = {
        mint: 'BundleMint2',
        symbol: 'BNDL2',
        customBundledSupplyPct: 25.01,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      };
      const reportFail = engine.evaluate(inputAt25Point01);
      expect(reportFail.checks.BUNDLED_PURCHASES.status).toBe('FAIL');
      expect(reportFail.checks.BUNDLED_PURCHASES.reasonCode).toBe<RiskReasonCode>(
        'BUNDLED_PURCHASES_EXCEEDS_LIMIT',
      );
    });

    it('enforces exit liquidity boundary at 15.0 SOL (rejects 14.99 SOL)', () => {
      const passLiqInput: ComprehensiveRiskInput = {
        mint: 'LiqMint1',
        symbol: 'LIQ1',
        customLiquiditySol: 15.0,
        analysisReport: createPassingAnalysisReport(),
      };
      const reportPass = engine.evaluate(passLiqInput);
      expect(reportPass.checks.LIQUIDITY_AND_EXIT.status).toBe('PASS');

      const failLiqInput: ComprehensiveRiskInput = {
        mint: 'LiqMint2',
        symbol: 'LIQ2',
        customLiquiditySol: 14.99,
        analysisReport: createPassingAnalysisReport(),
      };
      const reportFail = engine.evaluate(failLiqInput);
      expect(reportFail.checks.LIQUIDITY_AND_EXIT.status).toBe('FAIL');
      expect(reportFail.checks.LIQUIDITY_AND_EXIT.reasonCode).toBe<RiskReasonCode>(
        'LIQUIDITY_INSUFFICIENT',
      );
    });
  });

  describe('Multiple Accounts Per Wallet Aggregation', () => {
    it('aggregates multiple token accounts belonging to the same wallet address', () => {
      // 3 accounts owned by WalletA: 80M, 60M, 50M out of 1B (total 190M = 19%)
      // If treated individually, each is < 10%, but together they control 19%
      const rawHolders = [
        { ownerAddress: 'SybilWalletA', tokenAccountAddress: 'AccA1', balance: 80_000_000 },
        { ownerAddress: 'SybilWalletA', tokenAccountAddress: 'AccA2', balance: 60_000_000 },
        { ownerAddress: 'SybilWalletA', tokenAccountAddress: 'AccA3', balance: 50_000_000 },
        { ownerAddress: 'WalletB', tokenAccountAddress: 'AccB1', balance: 70_000_000 },
        { ownerAddress: 'WalletC', tokenAccountAddress: 'AccC1', balance: 60_000_000 },
        { ownerAddress: 'WalletD', tokenAccountAddress: 'AccD1', balance: 50_000_000 },
        {
          ownerAddress: 'BondingCurve111',
          tokenAccountAddress: 'AccCurve',
          balance: 500_000_000,
          isBondingCurve: true,
        },
      ];

      const report = engine.evaluate({
        mint: 'MultiAccountMint',
        symbol: 'MACC',
        rawHolders,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      });

      const topHoldersCheck = report.checks.TOP_HOLDERS_CONCENTRATION;
      // Total non-curve balance: 190M + 70M + 60M + 50M = 370M
      // SybilWalletA = 190M / 370M = 51.35%
      expect(topHoldersCheck.status).toBe('FAIL');
      expect(topHoldersCheck.evidence.metrics['uniqueWalletsAggregated']).toBe(4);
      expect(Number(topHoldersCheck.evidence.metrics['top10HoldingPct'])).toBeGreaterThan(50);
    });
  });

  describe('Holding Denominator Documentation', () => {
    it('documents supply denominator used in check evidence and final report', () => {
      const reportTotalSupply = engine.evaluate({
        mint: 'DenomMint1',
        symbol: 'DNM1',
        customCreatorHoldingPct: 6.0,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      });

      expect(reportTotalSupply.denominatorUsed).toBe('TOTAL_SUPPLY');
      expect(reportTotalSupply.checks.CREATOR_CONCENTRATION.evidence.denominator).toBe(
        'TOTAL_SUPPLY',
      );

      // Test with custom engine configured for CIRCULATING_SUPPLY
      const circulatingEngine = new DeterministicRiskEngine({
        holdingDenominator: 'CIRCULATING_SUPPLY',
      });
      const reportCirculating = circulatingEngine.evaluate({
        mint: 'DenomMint2',
        symbol: 'DNM2',
        customCreatorHoldingPct: 6.0,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      });

      expect(reportCirculating.denominatorUsed).toBe('CIRCULATING_SUPPLY');
      expect(reportCirculating.checks.CREATOR_CONCENTRATION.evidence.denominator).toBe(
        'CIRCULATING_SUPPLY',
      );
      expect(reportCirculating.checks.CREATOR_CONCENTRATION.evidence.explanation).toContain(
        'CIRCULATING_SUPPLY',
      );
    });
  });

  describe('Probabilistic vs Verified Bundle Distinction', () => {
    it('assigns MEDIUM confidence for probabilistic bundle detections', () => {
      const report = engine.evaluate({
        mint: 'ProbabilisticMint',
        symbol: 'PROB',
        customBundledSupplyPct: 28.0,
        isBundleVerified: false,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      });

      const bundleCheck = report.checks.BUNDLED_PURCHASES;
      expect(bundleCheck.status).toBe('FAIL');
      expect(bundleCheck.confidence).toBe('MEDIUM');
      expect(bundleCheck.evidence.metrics['isVerified']).toBe(false);
      expect(bundleCheck.evidence.explanation).toContain('PROBABILISTIC');
    });

    it('assigns HIGH confidence when bundle clustering is verified on-chain', () => {
      const report = engine.evaluate({
        mint: 'VerifiedMint',
        symbol: 'VRFD',
        customBundledSupplyPct: 28.0,
        isBundleVerified: true,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      });

      const bundleCheck = report.checks.BUNDLED_PURCHASES;
      expect(bundleCheck.status).toBe('FAIL');
      expect(bundleCheck.confidence).toBe('HIGH');
      expect(bundleCheck.evidence.metrics['isVerified']).toBe(true);
      expect(bundleCheck.evidence.explanation).toContain('VERIFIED');
    });
  });

  describe('Invariant: Missing Critical Data NEVER Classifies UNKNOWN as PASS', () => {
    it('yields UNKNOWN or FAIL when critical risk fields are missing, never PASS', () => {
      // 1. Missing analysis report entirely
      const missingReport = engine.evaluate({
        mint: 'MissingReportMint',
        symbol: 'MSSG',
      });

      expect(missingReport.passed).toBe(false);
      expect(missingReport.overallStatus).toBe('FAIL');
      expect(missingReport.checks.DATA_COMPLETENESS.status).toBe('FAIL');
      expect(missingReport.checks.DATA_COMPLETENESS.reasonCode).toBe<RiskReasonCode>(
        'DATA_COMPLETENESS_CRITICAL_MISSING',
      );

      // 2. Creator holding data missing / UNKNOWN
      const passReport = createPassingAnalysisReport();
      const reportWithMissingCreator = engine.evaluate({
        mint: 'MissingCreatorMint',
        symbol: 'NOCR',
        analysisReport: {
          ...passReport,
          creatorHoldings: {
            ...passReport.creatorHoldings,
            percentageOfSupply: {
              ...passReport.creatorHoldings.percentageOfSupply,
              value: null as unknown as number,
              status: 'UNKNOWN',
            },
          },
        },
      });

      expect(reportWithMissingCreator.checks.CREATOR_CONCENTRATION.status).toBe('UNKNOWN');
      expect(reportWithMissingCreator.passed).toBe(false);
      expect(reportWithMissingCreator.overallStatus).not.toBe('PASS');

      // 3. Authority data UNKNOWN
      const reportWithUnknownAuth = engine.evaluate({
        mint: 'UnknownAuthMint',
        symbol: 'NOAUTH',
        customLiquiditySol: 25.0,
        customCreatorHoldingPct: 2.0,
        analysisReport: {
          ...passReport,
          authorities: {
            ...passReport.authorities,
            isMintAuthorityRevoked: {
              ...passReport.authorities.isMintAuthorityRevoked,
              value: 'UNKNOWN' as unknown as boolean,
              status: 'UNKNOWN',
            },
          },
        },
      });

      expect(reportWithUnknownAuth.checks.TOKEN_AUTHORITIES.status).toBe('UNKNOWN');
      expect(reportWithUnknownAuth.passed).toBe(false);
      expect(reportWithUnknownAuth.overallStatus).toBe('UNKNOWN');
    });
  });

  describe('Token Authorities and Security Configurations', () => {
    it('rejects tokens where mint authority is not revoked', () => {
      const passReport = createPassingAnalysisReport();
      const activeMintReport = engine.evaluate({
        mint: 'ActiveMintAuth',
        symbol: 'ACTVM',
        customLiquiditySol: 25.0,
        customCreatorHoldingPct: 2.0,
        analysisReport: {
          ...passReport,
          authorities: {
            ...passReport.authorities,
            isMintAuthorityRevoked: {
              ...passReport.authorities.isMintAuthorityRevoked,
              value: false,
            },
            mintAuthority: {
              ...passReport.authorities.mintAuthority,
              value: 'ActiveDevKey11111111111111111111111111111',
            },
          },
        },
      });

      expect(activeMintReport.checks.TOKEN_AUTHORITIES.status).toBe('FAIL');
      expect(activeMintReport.checks.TOKEN_AUTHORITIES.reasonCode).toBe<RiskReasonCode>(
        'TOKEN_AUTHORITIES_MINT_NOT_REVOKED',
      );
      expect(activeMintReport.passed).toBe(false);
    });

    it('rejects tokens where freeze authority is not revoked (honeypot risk)', () => {
      const passReport = createPassingAnalysisReport();
      const activeFreezeReport = engine.evaluate({
        mint: 'ActiveFreezeAuth',
        symbol: 'ACTVF',
        customLiquiditySol: 25.0,
        customCreatorHoldingPct: 2.0,
        analysisReport: {
          ...passReport,
          authorities: {
            ...passReport.authorities,
            isFreezeAuthorityRevoked: {
              ...passReport.authorities.isFreezeAuthorityRevoked,
              value: false,
            },
            freezeAuthority: {
              ...passReport.authorities.freezeAuthority,
              value: 'FreezeDevKey11111111111111111111111111111',
            },
          },
        },
      });

      expect(activeFreezeReport.checks.TOKEN_AUTHORITIES.status).toBe('FAIL');
      expect(activeFreezeReport.checks.TOKEN_AUTHORITIES.reasonCode).toBe<RiskReasonCode>(
        'TOKEN_AUTHORITIES_FREEZE_NOT_REVOKED',
      );
      expect(activeFreezeReport.passed).toBe(false);
    });
  });

  describe('Historical Evidence of Harmful Launches and Accusation Rules', () => {
    it('requires verifiable evidence before flagging previous harmful launches', () => {
      const inputWithConfirmedRug: ComprehensiveRiskInput = {
        mint: 'RugMint1',
        symbol: 'RUG1',
        customLiquiditySol: 25.0,
        customCreatorHoldingPct: 2.0,
        analysisReport: createPassingAnalysisReport(),
        creatorHistory: {
          walletAddress: 'MaliciousDev11111111111111111111111111111',
          analyzedAt: new Date(),
          expiresAt: new Date(Date.now() + 600_000),
          freshnessMs: 0,
          isFresh: true,
          isExpired: false,
          coverage: {
            coverage: 'FULL_HISTORY',
            startTime: null,
            endTime: null,
            startSlot: null,
            endSlot: null,
            totalSignaturesObserved: 50,
            isTruncated: false,
          },
          launches: [],
          largeTransfers: [],
          largeSells: [],
          repeatedRelationships: [],
          earlyPurchases: [],
          recurringPatterns: [],
          knownHarmfulBehaviors: [
            {
              behaviorType: 'CONFIRMED_RUG_PULL',
              description: 'Observed dev drain on token X',
              evidence: {
                signatures: [
                  'RugSig1111111111111111111111111111111111111111111111111111111111111111111',
                ],
                addresses: [
                  'MaliciousDev11111111111111111111111111111',
                  'OldRuggedMint1111111111111111111111111111111',
                ],
                description: 'Liquidity pull confirmed',
                source: 'wallet_history',
                observedAt: new Date(),
                nature: 'OBSERVED',
              },
              confirmedAt: new Date(),
            },
          ],
          warnings: [],
          riskLevel: 'CRITICAL',
          riskScore: 95,
          isNewWalletWithoutHistory: false,
          explanation: 'Prior rug confirmed',
        },
      };

      const report = engine.evaluate(inputWithConfirmedRug);
      const harmfulCheck = report.checks.PREVIOUS_HARMFUL_LAUNCHES;

      expect(harmfulCheck.status).toBe('FAIL');
      expect(harmfulCheck.reasonCode).toBe<RiskReasonCode>('PREVIOUS_HARMFUL_LAUNCHES_FAIL');
      expect(harmfulCheck.evidence.signatures).toContain(
        'RugSig1111111111111111111111111111111111111111111111111111111111111111111',
      );
      expect(harmfulCheck.confidence).toBe('HIGH');
    });

    it('flags fresh creator wallet with UNVERIFIED warning instead of claiming safe or malicious', () => {
      const inputFreshWallet: ComprehensiveRiskInput = {
        mint: 'FreshCreatorMint',
        symbol: 'FRESH',
        customLiquiditySol: 25.0,
        customCreatorHoldingPct: 2.0,
        analysisReport: createPassingAnalysisReport(),
        creatorHistory: {
          walletAddress: 'FreshDev111111111111111111111111111111111',
          analyzedAt: new Date(),
          expiresAt: new Date(Date.now() + 600_000),
          freshnessMs: 0,
          isFresh: true,
          isExpired: false,
          coverage: {
            coverage: 'INSUFFICIENT_HISTORY',
            startTime: null,
            endTime: null,
            startSlot: null,
            endSlot: null,
            totalSignaturesObserved: 1,
            isTruncated: false,
          },
          launches: [],
          largeTransfers: [],
          largeSells: [],
          repeatedRelationships: [],
          earlyPurchases: [],
          recurringPatterns: [],
          knownHarmfulBehaviors: [],
          warnings: [],
          riskLevel: 'UNKNOWN',
          riskScore: 45,
          isNewWalletWithoutHistory: true,
          explanation: 'Fresh wallet',
        },
      };

      const report = engine.evaluate(inputFreshWallet);
      const harmfulCheck = report.checks.PREVIOUS_HARMFUL_LAUNCHES;

      expect(harmfulCheck.status).toBe('WARN');
      expect(harmfulCheck.reasonCode).toBe<RiskReasonCode>(
        'PREVIOUS_HARMFUL_LAUNCHES_UNVERIFIED_NEW',
      );
      expect(harmfulCheck.evidence.explanation).toContain(
        'Lack of history does NOT confirm safety',
      );
    });
  });

  describe('Configurable Thresholds and Updates', () => {
    it('supports runtime configuration changes via updateConfig', () => {
      const customEngine = new DeterministicRiskEngine({
        creatorHoldingsThresholdPct: 5.0, // stricter 5%
      });

      const report1 = customEngine.evaluate({
        mint: 'ConfigMint1',
        symbol: 'CFG1',
        customCreatorHoldingPct: 7.0,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      });
      expect(report1.checks.CREATOR_CONCENTRATION.status).toBe('FAIL');

      // Relax threshold to 8%
      customEngine.updateConfig({ creatorHoldingsThresholdPct: 8.0 });
      const report2 = customEngine.evaluate({
        mint: 'ConfigMint1',
        symbol: 'CFG1',
        customCreatorHoldingPct: 7.0,
        customLiquiditySol: 20.0,
        analysisReport: createPassingAnalysisReport(),
      });
      expect(report2.checks.CREATOR_CONCENTRATION.status).toBe('PASS');
    });
  });

  describe('Complete Structured Risk Report Structure', () => {
    it('produces a full TokenRiskReport evaluating all 10 independent categories', () => {
      const report = engine.evaluate({
        mint: 'AllPassMint111111111111111111111111111111111',
        symbol: 'ALLPASS',
        customLiquiditySol: 25.0,
        customCreatorHoldingPct: 3.0,
        analysisReport: createPassingAnalysisReport(),
        creatorHistory: {
          walletAddress: 'SafeDev111111111111111111111111111111111',
          analyzedAt: new Date(),
          expiresAt: new Date(Date.now() + 600_000),
          freshnessMs: 0,
          isFresh: true,
          isExpired: false,
          coverage: {
            coverage: 'FULL_HISTORY',
            startTime: null,
            endTime: null,
            startSlot: null,
            endSlot: null,
            totalSignaturesObserved: 50,
            isTruncated: false,
          },
          launches: [
            {
              mint: 'SafePastMint1111111111111111111111111111111',
              symbol: 'PAST',
              deployedAt: new Date(),
              initialLiquiditySol: 20,
              evidenceSignature: 'SafeDeploySig111111111111111111111111111111111111111111',
              slot: 280000,
              finalOutcome: 'ACTIVE',
              liquidityDrainedOrPulled: false,
            },
          ],
          largeTransfers: [],
          largeSells: [],
          repeatedRelationships: [],
          earlyPurchases: [],
          recurringPatterns: [],
          knownHarmfulBehaviors: [],
          warnings: [],
          riskLevel: 'SAFE',
          riskScore: 0,
          isNewWalletWithoutHistory: false,
          explanation: 'Safe established creator profile',
        },
      });

      expect(report.mint).toBe('AllPassMint111111111111111111111111111111111');
      expect(report.symbol).toBe('ALLPASS');
      expect(report.overallStatus).toBe('PASS');
      expect(report.passed).toBe(true);
      expect(report.overallScore).toBe(0);
      expect(report.summary).toContain('PASSED');

      // Check all 10 independent categories are present
      const expectedCategories = [
        'CREATOR_CONCENTRATION',
        'TOP_HOLDERS_CONCENTRATION',
        'BUNDLED_PURCHASES',
        'CREATOR_BEHAVIOR',
        'PREVIOUS_HARMFUL_LAUNCHES',
        'LIQUIDITY_AND_EXIT',
        'TRADING_AND_SELLING',
        'TOKEN_AUTHORITIES',
        'DATA_COMPLETENESS',
        'PRICE_AND_VOLUME',
      ] as const;

      for (const cat of expectedCategories) {
        const check = report.checks[cat];
        expect(check).toBeDefined();
        expect(check.category).toBe(cat);
        expect(['PASS', 'WARN', 'FAIL', 'UNKNOWN']).toContain(check.status);
        expect(check.reasonCode).toBeDefined();
        expect(check.evidence).toBeDefined();
        expect(check.source).toBeDefined();
        expect(check.observedAt instanceof Date).toBe(true);
        expect(['HIGH', 'MEDIUM', 'LOW']).toContain(check.confidence);
      }
    });
  });
});
