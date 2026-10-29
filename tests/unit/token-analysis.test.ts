import { describe, it, expect, beforeEach } from 'vitest';
import { TokenAnalysisService } from '../../src/modules/analysis/token-analysis.service.js';
import { SyntheticAnalysisProvider } from '../../src/modules/analysis/providers/synthetic-analysis-provider.js';
import type { AnalyzedField } from '../../src/modules/analysis/analysis.types.js';

describe('TokenAnalysisService', () => {
  let service: TokenAnalysisService;
  let mockProvider: SyntheticAnalysisProvider;

  beforeEach(() => {
    mockProvider = new SyntheticAnalysisProvider({ name: 'mock_synthetic' });
    service = new TokenAnalysisService(mockProvider, {
      defaultRpcBudget: 8,
      maxConcurrency: 2,
    });
  });

  it('collects and normalizes all 11 required dimensions of token analysis', async () => {
    const mint = 'SyntH11111111111111111111111111111111111111';
    const creator = 'Dev1111111111111111111111111111111111111111';
    const curve = 'Curve111111111111111111111111111111111111111';

    const report = await service.analyzeToken(mint, {
      creatorAddress: creator,
      bondingCurveAddress: curve,
      bypassCache: true,
      rpcBudget: 15,
    });

    // 1. Token mint and supply
    expect(report.supply.mint.value).toBe(mint);
    expect(report.supply.supply.value).toBe(1_000_000_000);
    expect(report.supply.decimals.value).toBe(6);
    expect(report.supply.isInitialized.value).toBe(true);

    // 2. Creator wallet
    expect(report.creatorWallet.address.value).toBe(creator);
    expect(typeof report.creatorWallet.solBalance.value).toBe('number');
    expect(report.creatorWallet.exists.value).toBe(true);

    // 3. Current holder distribution
    expect(typeof report.holderDistribution.top10PercentShare.value).toBe('number');
    expect(typeof report.holderDistribution.concentrationLevel.value).toBe('string');

    // 4. Creator's token holdings
    expect(report.creatorHoldings.creatorAddress.value).toBe(creator);
    expect(typeof report.creatorHoldings.tokenBalance.value).toBe('number');
    expect(report.creatorHoldings.percentageOfSupply.value).toBe(5.0);

    // 5. Largest holder concentrations
    expect(Array.isArray(report.largestHolders.topHolders.value)).toBe(true);
    expect(typeof report.largestHolders.bondingCurvePercentage.value).toBe('number');
    expect(typeof report.largestHolders.nonCurveTop10Percentage.value).toBe('number');

    // 6. Recent buy and sell activity
    expect(typeof report.recentActivity.totalTransactions.value).toBe('number');
    expect(typeof report.recentActivity.netFlowSol.value).toBe('number');

    // 7. Liquidity and market depth
    expect(typeof report.liquidityAndDepth.liquiditySol.value).toBe('number');
    expect(typeof report.liquidityAndDepth.currentPriceSol.value).toBe('number');
    expect(Array.isArray(report.liquidityAndDepth.marketDepth.value)).toBe(true);

    // 8. Trading volume
    expect(typeof report.volume.totalVolumeSol.value).toBe('number');

    // 9. Available token authorities and their status
    expect(report.authorities.mintAuthority.value).toBeNull();
    expect(report.authorities.freezeAuthority.value).toBeNull();
    expect(report.authorities.isMintAuthorityRevoked.value).toBe(true);
    expect(report.authorities.isFreezeAuthorityRevoked.value).toBe(true);

    // 10. Related wallet activity
    expect(Array.isArray(report.relatedWallets.linkedWallets.value)).toBe(true);

    // 11. Relevant historical creator activity
    expect(typeof report.creatorHistory.walletAgeDays.value).toBe('number');
    expect(report.creatorHistory.reputationTier.value).toBe('ESTABLISHED_SAFE');

    // Overall summary
    expect(report.overallSummary.dataCompletenessPct).toBeGreaterThan(80);
    expect(report.overallSummary.confidenceWeightedScore).toBeGreaterThan(0.7);
  });

  it('records required metadata for every field (source, timestamp, confidence, freshness, nature)', async () => {
    const mint = 'SyntH22222222222222222222222222222222222222';
    const report = await service.analyzeToken(mint, { bypassCache: true });

    const checkFieldMetadata = (field: AnalyzedField<unknown>, label: string) => {
      expect(field, `${label} must be defined`).toBeDefined();
      expect(field.value !== undefined, `${label}.value must not be undefined`).toBe(true);
      expect(typeof field.source, `${label}.source must be string`).toBe('string');
      expect(field.observedAt instanceof Date, `${label}.observedAt must be Date`).toBe(true);
      expect(['HIGH', 'MEDIUM', 'LOW'], `${label}.confidence`).toContain(field.confidence);
      expect(typeof field.confidenceScore, `${label}.confidenceScore`).toBe('number');
      expect(['FRESH', 'STALE', 'EXPIRED'], `${label}.freshness`).toContain(field.freshness);
      expect(typeof field.freshnessMs, `${label}.freshnessMs`).toBe('number');
      expect(['DIRECT', 'INFERRED'], `${label}.nature`).toContain(field.nature);
      expect(['CONFIRMED', 'UNKNOWN', 'STALE', 'CONTRADICTORY'], `${label}.status`).toContain(
        field.status,
      );
    };

    checkFieldMetadata(report.supply.supply, 'supply');
    checkFieldMetadata(report.supply.decimals, 'decimals');
    checkFieldMetadata(report.authorities.freezeAuthority, 'freezeAuthority');
    checkFieldMetadata(report.liquidityAndDepth.liquiditySol, 'liquiditySol');
    checkFieldMetadata(report.volume.totalVolumeSol, 'volume');
    checkFieldMetadata(report.creatorHistory.reputationTier, 'reputationTier');
  });

  it('enforces request budgets and degrades remaining calls to UNKNOWN when budget is exhausted', async () => {
    const mint = 'SyntH33333333333333333333333333333333333333';

    // Set budget limit to 2 RPC requests only
    const report = await service.analyzeToken(mint, {
      rpcBudget: 2,
      bypassCache: true,
      creatorAddress: 'Dev1111111111111111111111111111111111111111',
    });

    expect(report.budgetUsed.rpcBudgetLimit).toBe(2);
    expect(report.budgetUsed.budgetExhausted).toBe(true);
    expect(report.overallSummary.unknownFieldCount).toBeGreaterThan(0);
  });

  it('returns cached report on subsequent requests without redundant provider calls', async () => {
    const mint = 'SyntH44444444444444444444444444444444444444';

    const first = await service.analyzeToken(mint, { bypassCache: true });
    expect(first.isCacheHit).toBe(false);

    const second = await service.analyzeToken(mint, { bypassCache: false });
    expect(second.isCacheHit).toBe(true);
    expect(second.mint).toBe(first.mint);
    expect(service.getMetrics().cacheHits).toBe(1);
  });
});
