import type { ITokenAnalysisDataProvider } from './analysis-provider.interface.js';
import type {
  TokenSupplyAnalysis,
  CreatorWalletAnalysis,
  HolderDistributionAnalysis,
  CreatorHoldingsAnalysis,
  LargestHoldersAnalysis,
  RecentActivityAnalysis,
  LiquidityMarketDepthAnalysis,
  TradingVolumeAnalysis,
  TokenAuthoritiesAnalysis,
  RelatedWalletsAnalysis,
  CreatorHistoryAnalysis,
  TopHolderEntry,
  MarketDepthBucket,
} from '../analysis.types.js';
import { createField, createUnknownField, createContradictoryField } from '../analysis.types.js';
import type { RequestBudget } from '../budget/request-budget.js';
import { walletEvidenceEngine } from '../wallet-evidence/wallet-evidence-engine.js';

export interface SyntheticProviderConfig {
  name?: string;
  simulateMissingFields?: boolean;
  simulateStaleFields?: boolean;
  simulateContradictions?: boolean;
  simulateMalformedData?: boolean;
  staleAgeMs?: number;
}

export class SyntheticAnalysisProvider implements ITokenAnalysisDataProvider {
  public readonly name: string;
  private config: SyntheticProviderConfig;

  constructor(config: SyntheticProviderConfig = {}) {
    this.name = config.name ?? 'synthetic_provider';
    this.config = config;
  }

  public updateConfig(config: Partial<SyntheticProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public async fetchTokenSupply(
    mint: string,
    budget: RequestBudget,
  ): Promise<TokenSupplyAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:supply`;

    if (this.config.simulateMissingFields) {
      return {
        mint: createField(mint, { source }),
        supply: createUnknownField(source, 'Synthetic simulation: supply unavailable'),
        rawSupply: createUnknownField(source, 'Synthetic simulation: rawSupply unavailable'),
        decimals: createUnknownField(source, 'Synthetic simulation: decimals unavailable'),
        isInitialized: createUnknownField(
          source,
          'Synthetic simulation: isInitialized unavailable',
        ),
      };
    }

    if (this.config.simulateMalformedData) {
      return {
        mint: createField(mint, { source }),
        supply: createUnknownField(source, 'Malformed negative supply detected: -1000'),
        rawSupply: createField('-1000', { source, confidence: 'LOW' }),
        decimals: createUnknownField(source, 'Malformed decimals detected: 99'),
        isInitialized: createField(true, { source }),
      };
    }

    const observedAt = this.config.simulateStaleFields
      ? new Date(Date.now() - (this.config.staleAgeMs ?? 180_000))
      : new Date();

    return {
      mint: createField(mint, { source, observedAt }),
      supply: createField(1_000_000_000, { source, observedAt, confidence: 'HIGH' }),
      rawSupply: createField('1000000000000000', { source, observedAt, confidence: 'HIGH' }),
      decimals: createField(6, { source, observedAt, confidence: 'HIGH' }),
      isInitialized: createField(true, { source, observedAt, confidence: 'HIGH' }),
    };
  }

  public async fetchTokenAuthorities(
    _mint: string,
    budget: RequestBudget,
  ): Promise<TokenAuthoritiesAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:authorities`;

    if (this.config.simulateMissingFields) {
      return {
        mintAuthority: createUnknownField(
          source,
          'Synthetic simulation: mintAuthority unavailable',
        ),
        freezeAuthority: createUnknownField(
          source,
          'Synthetic simulation: freezeAuthority unavailable',
        ),
        isMintAuthorityRevoked: createUnknownField(
          source,
          'Synthetic simulation: revocation unavailable',
        ),
        isFreezeAuthorityRevoked: createUnknownField(
          source,
          'Synthetic simulation: revocation unavailable',
        ),
        updateAuthority: createUnknownField(
          source,
          'Synthetic simulation: updateAuthority unavailable',
        ),
      };
    }

    if (this.config.simulateContradictions) {
      return {
        mintAuthority: createContradictoryField(
          'Auth111111111111111111111111111111111111111',
          source,
          'Contradiction simulated between on-chain account and registry',
        ),
        freezeAuthority: createContradictoryField(
          null,
          source,
          'Contradiction simulated on freeze authority',
        ),
        isMintAuthorityRevoked: createContradictoryField(false, source, 'Conflicting status'),
        isFreezeAuthorityRevoked: createContradictoryField(true, source, 'Conflicting status'),
        updateAuthority: createUnknownField(source, 'Update authority unavailable'),
      };
    }

    return {
      mintAuthority: createField(null, { source, confidence: 'HIGH' }),
      freezeAuthority: createField(null, { source, confidence: 'HIGH' }),
      isMintAuthorityRevoked: createField(true, { source, confidence: 'HIGH' }),
      isFreezeAuthorityRevoked: createField(true, { source, confidence: 'HIGH' }),
      updateAuthority: createField('UpdAuth11111111111111111111111111111111111111', {
        source,
        confidence: 'HIGH',
      }),
    };
  }

  public async fetchHolderConcentration(
    _mint: string,
    creatorAddress: string,
    bondingCurveAddress: string,
    budget: RequestBudget,
  ): Promise<{
    largestHolders: LargestHoldersAnalysis;
    distribution: HolderDistributionAnalysis;
  } | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:holders`;

    if (this.config.simulateMissingFields) {
      const unk = createUnknownField<number>(source, 'Holders unavailable');
      return {
        largestHolders: {
          topHolders: createUnknownField(source, 'Holders unavailable'),
          nonCurveTop10Percentage: unk,
          bondingCurvePercentage: unk,
          hasHighConcentration: createUnknownField(source, 'Holders unavailable'),
          observedAccountsCount: unk,
        },
        distribution: {
          totalHoldersCount: unk,
          top5PercentShare: unk,
          top10PercentShare: unk,
          top20PercentShare: unk,
          concentrationLevel: createUnknownField(source, 'Holders unavailable'),
          giniCoefficient: unk,
        },
      };
    }

    const topHolders: TopHolderEntry[] = [
      {
        address: bondingCurveAddress || 'BondingCurveSynthetic111111111111111111111',
        balance: 800_000_000,
        percentage: 80.0,
        isBondingCurve: true,
        isCreator: false,
        label: 'Bonding Curve',
      },
      {
        address: creatorAddress || 'DevSynthetic111111111111111111111111111111',
        balance: 50_000_000,
        percentage: 5.0,
        isBondingCurve: false,
        isCreator: true,
        label: 'Creator',
      },
      {
        address: 'HolderSynthetic111111111111111111111111111111',
        balance: 40_000_000,
        percentage: 4.0,
        isBondingCurve: false,
        isCreator: false,
        label: 'Community',
      },
    ];

    return {
      largestHolders: {
        topHolders: createField(topHolders, { source, confidence: 'HIGH' }),
        nonCurveTop10Percentage: createField(9.0, {
          source,
          confidence: 'HIGH',
          nature: 'INFERRED',
        }),
        bondingCurvePercentage: createField(80.0, { source, confidence: 'HIGH', nature: 'DIRECT' }),
        hasHighConcentration: createField(false, {
          source,
          confidence: 'HIGH',
          nature: 'INFERRED',
        }),
        observedAccountsCount: createField(3, { source, confidence: 'HIGH' }),
      },
      distribution: {
        totalHoldersCount: createField(42, { source, confidence: 'MEDIUM' }),
        top5PercentShare: createField(89.0, { source, confidence: 'HIGH', nature: 'INFERRED' }),
        top10PercentShare: createField(89.0, { source, confidence: 'HIGH', nature: 'INFERRED' }),
        top20PercentShare: createField(89.0, { source, confidence: 'HIGH', nature: 'INFERRED' }),
        concentrationLevel: createField('LOW', { source, confidence: 'HIGH', nature: 'INFERRED' }),
        giniCoefficient: createField(0.35, { source, confidence: 'MEDIUM', nature: 'INFERRED' }),
      },
    };
  }

  public async fetchCreatorWallet(
    creatorAddress: string,
    budget: RequestBudget,
  ): Promise<CreatorWalletAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:creatorWallet`;

    if (this.config.simulateMissingFields) {
      return {
        address: createField(creatorAddress, { source }),
        solBalance: createUnknownField(source, 'Synthetic simulation: balance unavailable'),
        exists: createUnknownField(source, 'Synthetic simulation: exists unavailable'),
        accountType: createUnknownField(source, 'Synthetic simulation: accountType unavailable'),
      };
    }

    return {
      address: createField(creatorAddress, { source, confidence: 'HIGH' }),
      solBalance: createField(2.45, { source, confidence: 'HIGH' }),
      exists: createField(true, { source, confidence: 'HIGH' }),
      accountType: createField('SYSTEM_ACCOUNT', { source, confidence: 'HIGH' }),
    };
  }

  public async fetchCreatorHoldings(
    _mint: string,
    creatorAddress: string,
    _totalSupply: number | null,
    budget: RequestBudget,
  ): Promise<CreatorHoldingsAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:creatorHoldings`;

    if (this.config.simulateMissingFields) {
      return {
        creatorAddress: createField(creatorAddress, { source }),
        tokenBalance: createUnknownField(
          source,
          'Synthetic simulation: creator balance unavailable',
        ),
        percentageOfSupply: createUnknownField(
          source,
          'Synthetic simulation: percentage unavailable',
        ),
        hasSoldTokens: createUnknownField(source, 'Synthetic simulation: activity unavailable'),
        holdingStatus: createUnknownField(
          source,
          'Synthetic simulation: holding status unavailable',
        ),
      };
    }

    return {
      creatorAddress: createField(creatorAddress, { source }),
      tokenBalance: createField(50_000_000, { source, confidence: 'HIGH' }),
      percentageOfSupply: createField(5.0, { source, confidence: 'HIGH', nature: 'INFERRED' }),
      hasSoldTokens: createField(false, { source, confidence: 'HIGH', nature: 'INFERRED' }),
      holdingStatus: createField('HOLDING', { source, confidence: 'HIGH', nature: 'INFERRED' }),
    };
  }

  public async fetchRecentActivity(
    _mint: string,
    budget: RequestBudget,
  ): Promise<RecentActivityAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:recentActivity`;

    if (this.config.simulateMissingFields) {
      const unk = createUnknownField<number>(source, 'Activity unavailable');
      return {
        observationWindowSeconds: createField(300, { source }),
        totalTransactions: unk,
        buyCount: unk,
        sellCount: unk,
        buyVolumeSol: unk,
        sellVolumeSol: unk,
        netFlowSol: unk,
        recentTrades: createUnknownField(source, 'Activity unavailable'),
      };
    }

    return {
      observationWindowSeconds: createField(300, { source }),
      totalTransactions: createField(12, { source, confidence: 'HIGH' }),
      buyCount: createField(9, { source, confidence: 'HIGH' }),
      sellCount: createField(3, { source, confidence: 'HIGH' }),
      buyVolumeSol: createField(4.2, { source, confidence: 'HIGH' }),
      sellVolumeSol: createField(1.1, { source, confidence: 'HIGH' }),
      netFlowSol: createField(3.1, { source, confidence: 'HIGH', nature: 'INFERRED' }),
      recentTrades: createField([], { source, confidence: 'HIGH' }),
    };
  }

  public async fetchLiquidityAndDepth(
    _mint: string,
    _bondingCurveAddress: string,
    budget: RequestBudget,
  ): Promise<LiquidityMarketDepthAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:liquidity`;

    if (this.config.simulateMissingFields) {
      const unk = createUnknownField<number>(source, 'Liquidity unavailable');
      return {
        liquiditySol: unk,
        tokenReserves: unk,
        virtualSolReserves: unk,
        virtualTokenReserves: unk,
        currentPriceSol: unk,
        marketDepth: createUnknownField(source, 'Depth unavailable'),
        bondingCurveProgressPct: unk,
      };
    }

    const depthBuckets: MarketDepthBucket[] = [
      { orderSolAmount: 0.5, estimatedPriceImpactPct: 1.6, estimatedTokensOut: 16_000_000 },
      { orderSolAmount: 1.0, estimatedPriceImpactPct: 3.2, estimatedTokensOut: 31_000_000 },
      { orderSolAmount: 5.0, estimatedPriceImpactPct: 15.5, estimatedTokensOut: 140_000_000 },
    ];

    return {
      liquiditySol: createField(24.5, { source, confidence: 'HIGH' }),
      tokenReserves: createField(1_073_000_000, { source, confidence: 'HIGH' }),
      virtualSolReserves: createField(54.5, { source, confidence: 'HIGH' }),
      virtualTokenReserves: createField(1_073_000_000, { source, confidence: 'HIGH' }),
      currentPriceSol: createField(0.00000005, { source, confidence: 'HIGH', nature: 'INFERRED' }),
      marketDepth: createField(depthBuckets, { source, confidence: 'HIGH', nature: 'INFERRED' }),
      bondingCurveProgressPct: createField(28.8, {
        source,
        confidence: 'HIGH',
        nature: 'INFERRED',
      }),
    };
  }

  public async fetchTradingVolume(
    _mint: string,
    budget: RequestBudget,
  ): Promise<TradingVolumeAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:volume`;

    if (this.config.simulateMissingFields) {
      const unk = createUnknownField<number>(source, 'Volume unavailable');
      return {
        totalVolumeSol: unk,
        buyVolumeSol: unk,
        sellVolumeSol: unk,
        tradeCount: unk,
        windowSeconds: createField(86400, { source }),
      };
    }

    return {
      totalVolumeSol: createField(18.5, { source, confidence: 'HIGH' }),
      buyVolumeSol: createField(14.0, { source, confidence: 'HIGH' }),
      sellVolumeSol: createField(4.5, { source, confidence: 'HIGH' }),
      tradeCount: createField(45, { source, confidence: 'HIGH' }),
      windowSeconds: createField(86400, { source }),
    };
  }

  public async fetchCreatorHistory(
    _creatorAddress: string,
    budget: RequestBudget,
  ): Promise<CreatorHistoryAnalysis | null> {
    if (!budget.consume(1)) return null;
    const source = `${this.name}:creatorHistory`;

    if (this.config.simulateMissingFields) {
      const unk = createUnknownField<number>(source, 'Creator history unavailable');
      return {
        totalPastTokensLaunched: unk,
        pastTokens: createUnknownField(source, 'Past tokens unavailable'),
        walletAgeDays: unk,
        firstSeenSlot: unk,
        rugPullCount: unk,
        reputationTier: createUnknownField(source, 'Reputation tier unavailable'),
        reputationRiskScore: unk,
      };
    }

    return {
      totalPastTokensLaunched: createField(1, { source, confidence: 'HIGH' }),
      pastTokens: createField([], { source, confidence: 'HIGH' }),
      walletAgeDays: createField(12.5, { source, confidence: 'HIGH' }),
      firstSeenSlot: createField(240000100, { source, confidence: 'HIGH' }),
      rugPullCount: createField(0, { source, confidence: 'HIGH' }),
      reputationTier: createField('ESTABLISHED_SAFE', {
        source,
        confidence: 'HIGH',
        nature: 'INFERRED',
      }),
      reputationRiskScore: createField(15, { source, confidence: 'HIGH', nature: 'INFERRED' }),
    };
  }

  public async fetchRelatedWallets(
    targetWallet: string,
    candidateWallets: string[],
    budget: RequestBudget,
  ): Promise<RelatedWalletsAnalysis | null> {
    if (!budget.consume(1)) return null;
    return walletEvidenceEngine.evaluateLinks(targetWallet, [
      ...candidateWallets.map((w) => ({
        walletA: targetWallet,
        walletB: w,
        type: 'SAME_TOKEN_TRADED' as const,
      })),
    ]);
  }
}
