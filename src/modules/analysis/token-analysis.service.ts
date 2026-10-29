import { EventEmitter } from 'node:events';
import type {
  TokenAnalysisReport,
  TokenAnalysisOptions,
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
  AnalyzedField,
} from './analysis.types.js';
import { createField, createUnknownField } from './analysis.types.js';
import { RequestBudget, BoundedConcurrencyQueue } from './budget/request-budget.js';
import { analysisCache, AnalysisCacheManager } from './cache/analysis-cache.js';
import type { ITokenAnalysisDataProvider } from './providers/analysis-provider.interface.js';
import { SolanaRpcAnalysisProvider } from './providers/solana-rpc-analysis-provider.js';
import { SyntheticAnalysisProvider } from './providers/synthetic-analysis-provider.js';
import { SolanaRpcClient } from '../ingestion/transport/rpc-client.js';
import { configService } from '../configuration/config.service.js';
import { walletEvidenceEngine } from './wallet-evidence/wallet-evidence-engine.js';
import { logger } from '../observability/logger.js';

export interface TokenAnalysisServiceConfig {
  defaultRpcBudget?: number;
  maxConcurrency?: number;
  maxQueueSize?: number;
}

export class TokenAnalysisService {
  private readonly emitter = new EventEmitter();
  private readonly concurrencyQueue: BoundedConcurrencyQueue;
  private readonly cache: AnalysisCacheManager;
  private readonly defaultRpcBudget: number;

  private primaryProvider: ITokenAnalysisDataProvider;
  private syntheticProvider: SyntheticAnalysisProvider;

  // Metrics
  private totalAnalyses = 0;
  private cacheHits = 0;
  private budgetExhaustions = 0;
  private failures = 0;

  private customProviderPassed = false;

  constructor(
    customProvider?: ITokenAnalysisDataProvider,
    config: TokenAnalysisServiceConfig = {},
  ) {
    let budgetFromConfig = 8;
    let concurrencyFromConfig = 3;
    try {
      const appCfg = configService.getAll();
      budgetFromConfig = appCfg.ANALYSIS_RPC_BUDGET_PER_TOKEN ?? 8;
      concurrencyFromConfig = appCfg.ANALYSIS_MAX_CONCURRENCY ?? 3;
    } catch {
      // Fallback in isolated test environments
    }

    this.defaultRpcBudget = config.defaultRpcBudget ?? budgetFromConfig;
    this.concurrencyQueue = new BoundedConcurrencyQueue(
      config.maxConcurrency ?? concurrencyFromConfig,
      config.maxQueueSize ?? 50,
    );
    this.cache = analysisCache;

    this.syntheticProvider = new SyntheticAnalysisProvider();

    if (customProvider) {
      this.primaryProvider = customProvider;
      this.customProviderPassed = true;
    } else {
      const appConfig = configService.getAll();
      const rpcClient = new SolanaRpcClient({
        httpUrl: appConfig.HELIUS_RPC_HTTP_URL || appConfig.SOLANA_RPC_HTTP_URL,
        apiKey: appConfig.HELIUS_API_KEY,
        maxRequestsPerSecond: appConfig.RPC_MAX_REQUESTS_PER_SECOND,
        timeoutMs: appConfig.RPC_TIMEOUT_MS,
        maxRetries: appConfig.RPC_MAX_RETRIES,
      });
      this.primaryProvider = new SolanaRpcAnalysisProvider(rpcClient);
    }
  }

  public setPrimaryProvider(provider: ITokenAnalysisDataProvider): void {
    this.primaryProvider = provider;
    this.customProviderPassed = true;
  }

  public getSyntheticProvider(): SyntheticAnalysisProvider {
    return this.syntheticProvider;
  }

  /**
   * Main entry point: Analyze a token across all required data dimensions.
   */
  public async analyzeToken(
    mint: string,
    options: TokenAnalysisOptions = {},
  ): Promise<TokenAnalysisReport> {
    const startTime = Date.now();

    // 1. Check Cache
    if (!options.bypassCache) {
      const cached = this.cache.reports.get(mint);
      if (cached) {
        this.cacheHits += 1;
        return {
          ...cached,
          isCacheHit: true,
        };
      }
    }

    // 2. Execute under Bounded Concurrency
    return this.concurrencyQueue.run(async () => {
      this.totalAnalyses += 1;
      const budgetLimit = options.rpcBudget ?? this.defaultRpcBudget;
      const budget = new RequestBudget(budgetLimit);

      // Determine provider: synthetic vs on-chain
      const isSynthetic =
        options.isSynthetic ?? (mint.startsWith('SyntH') || mint.includes('synthetic'));

      const provider = this.customProviderPassed
        ? this.primaryProvider
        : isSynthetic
          ? this.syntheticProvider
          : this.primaryProvider;

      try {
        const creatorAddress = options.creatorAddress ?? '';
        const bondingCurveAddress = options.bondingCurveAddress ?? '';

        // Step A: Token supply and authorities (cached if available)
        let supply = await provider.fetchTokenSupply(mint, budget);
        if (!supply) supply = this.createDefaultSupply(mint);

        let authorities: TokenAuthoritiesAnalysis | undefined = this.cache.authorities.get(mint);
        if (!authorities || options.bypassCache) {
          const fetchedAuthorities = await provider.fetchTokenAuthorities(mint, budget);
          authorities = fetchedAuthorities ?? this.createDefaultAuthorities();
          this.cache.authorities.set(mint, authorities);
        }

        const uiSupplyNumber = typeof supply.supply.value === 'number' ? supply.supply.value : null;

        // Step B: Holders & Concentration
        let holdersResult = await provider.fetchHolderConcentration(
          mint,
          creatorAddress,
          bondingCurveAddress,
          budget,
        );
        if (!holdersResult) {
          holdersResult = {
            largestHolders: this.createDefaultLargestHolders(),
            distribution: this.createDefaultHolderDistribution(),
          };
        }

        // Extract top holder addresses for wallet linking evaluation
        const topHolderAddresses = Array.isArray(holdersResult.largestHolders.topHolders.value)
          ? holdersResult.largestHolders.topHolders.value
              .filter((h) => !h.isBondingCurve && h.address !== creatorAddress)
              .map((h) => h.address)
          : [];

        // Step C: Creator wallet & holdings
        let creatorWallet: CreatorWalletAnalysis | null = null;
        let creatorHoldings: CreatorHoldingsAnalysis | null = null;

        if (creatorAddress) {
          creatorWallet = await provider.fetchCreatorWallet(creatorAddress, budget);
          creatorHoldings = await provider.fetchCreatorHoldings(
            mint,
            creatorAddress,
            uiSupplyNumber,
            budget,
          );
        }
        if (!creatorWallet) creatorWallet = this.createDefaultCreatorWallet(creatorAddress);
        if (!creatorHoldings) creatorHoldings = this.createDefaultCreatorHoldings(creatorAddress);

        // Step D: Liquidity and market depth
        let liquidityAndDepth = await provider.fetchLiquidityAndDepth(
          mint,
          bondingCurveAddress,
          budget,
        );
        if (!liquidityAndDepth) {
          liquidityAndDepth = this.createDefaultLiquidityAndDepth();
        }

        // Step E: Recent buy and sell activity & trading volume
        let recentActivity = await provider.fetchRecentActivity(mint, budget);
        if (!recentActivity) recentActivity = this.createDefaultRecentActivity();

        let volume = await provider.fetchTradingVolume(mint, budget);
        if (!volume) volume = this.createDefaultVolume();

        // Step F: Historical creator activity (cached across tokens by creator address)
        let creatorHistory: CreatorHistoryAnalysis | null = null;
        if (creatorAddress) {
          creatorHistory = this.cache.creatorHistory.get(creatorAddress) ?? null;
          if (!creatorHistory || options.bypassCache) {
            creatorHistory = await provider.fetchCreatorHistory(creatorAddress, budget);
            if (creatorHistory) {
              this.cache.creatorHistory.set(creatorAddress, creatorHistory);
            }
          }
        }
        if (!creatorHistory) creatorHistory = this.createDefaultCreatorHistory();

        // Step G: Related wallet activity
        // Enforces: "Do not claim that wallets are connected merely because they bought the same token."
        let relatedWallets: RelatedWalletsAnalysis | null = null;
        if (creatorAddress && topHolderAddresses.length > 0) {
          relatedWallets = await provider.fetchRelatedWallets(
            creatorAddress,
            topHolderAddresses,
            budget,
          );
        }
        if (!relatedWallets) {
          relatedWallets = walletEvidenceEngine.createEmptyAnalysis(
            creatorAddress ? 'No candidate links to evaluate' : 'Creator address not provided',
          );
        }

        if (budget.isExhausted()) {
          this.budgetExhaustions += 1;
        }

        // Step H: Summarize metrics across all fields
        const allFields: AnalyzedField<unknown>[] = [
          supply.mint,
          supply.supply,
          supply.decimals,
          authorities.mintAuthority,
          authorities.freezeAuthority,
          creatorWallet.solBalance,
          creatorHoldings.tokenBalance,
          creatorHoldings.percentageOfSupply,
          holdersResult.largestHolders.nonCurveTop10Percentage,
          holdersResult.largestHolders.bondingCurvePercentage,
          holdersResult.distribution.totalHoldersCount,
          recentActivity.totalTransactions,
          liquidityAndDepth.liquiditySol,
          liquidityAndDepth.currentPriceSol,
          volume.totalVolumeSol,
          creatorHistory.reputationTier,
          relatedWallets.connectedWalletCount,
        ];

        let confirmedCount = 0;
        let unknownCount = 0;
        let staleCount = 0;
        let contradictoryCount = 0;
        let confidenceAccumulator = 0;

        for (const f of allFields) {
          confidenceAccumulator += f.confidenceScore;
          if (f.status === 'CONFIRMED') confirmedCount += 1;
          else if (f.status === 'UNKNOWN') unknownCount += 1;
          else if (f.status === 'STALE') staleCount += 1;
          else if (f.status === 'CONTRADICTORY') contradictoryCount += 1;
        }

        const dataCompletenessPct =
          allFields.length > 0 ? Math.round((confirmedCount / allFields.length) * 1000) / 10 : 0;

        const confidenceWeightedScore =
          allFields.length > 0
            ? Math.round((confidenceAccumulator / allFields.length) * 100) / 100
            : 0;

        const report: TokenAnalysisReport = {
          mint,
          symbol: 'TOKEN',
          analyzedAt: new Date(),
          executionDurationMs: Date.now() - startTime,
          isCacheHit: false,
          budgetUsed: {
            rpcRequestsUsed: budget.getUsed(),
            rpcBudgetLimit: budget.getLimit(),
            budgetExhausted: budget.isExhausted(),
          },
          supply,
          creatorWallet,
          holderDistribution: holdersResult.distribution,
          creatorHoldings,
          largestHolders: holdersResult.largestHolders,
          recentActivity,
          liquidityAndDepth,
          volume,
          authorities,
          relatedWallets,
          creatorHistory,
          overallSummary: {
            dataCompletenessPct,
            confidenceWeightedScore,
            staleFieldCount: staleCount,
            contradictoryFieldCount: contradictoryCount,
            unknownFieldCount: unknownCount,
          },
        };

        // Cache completed report
        this.cache.reports.set(mint, report);

        this.emitter.emit('tokenAnalyzed', report);
        return report;
      } catch (err) {
        this.failures += 1;
        logger.error({ mint, err }, '[TokenAnalysisService] Token analysis failed');
        throw err;
      }
    });
  }

  public getCachedReport(mint: string): TokenAnalysisReport | undefined {
    return this.cache.reports.get(mint);
  }

  public onTokenAnalyzed(
    handler: (report: TokenAnalysisReport) => void | Promise<void>,
  ): () => void {
    this.emitter.on('tokenAnalyzed', handler);
    return () => {
      this.emitter.off('tokenAnalyzed', handler);
    };
  }

  public getMetrics() {
    return {
      totalAnalyses: this.totalAnalyses,
      cacheHits: this.cacheHits,
      budgetExhaustions: this.budgetExhaustions,
      failures: this.failures,
      activeConcurrency: this.concurrencyQueue.getActiveCount(),
      queueLength: this.concurrencyQueue.getQueueLength(),
      cachedReportsCount: this.cache.reports.size(),
    };
  }

  // --- Defaults for missing/unreachable sections (guarantees UNKNOWN, never 0) ---

  private createDefaultSupply(mint: string): TokenSupplyAnalysis {
    const src = 'token_analysis_service:default';
    return {
      mint: createField(mint, { source: src }),
      supply: createUnknownField(src, 'Supply unavailable'),
      rawSupply: createUnknownField(src, 'Raw supply unavailable'),
      decimals: createUnknownField(src, 'Decimals unavailable'),
      isInitialized: createUnknownField(src, 'Initialization status unavailable'),
    };
  }

  private createDefaultAuthorities(): TokenAuthoritiesAnalysis {
    const src = 'token_analysis_service:default';
    return {
      mintAuthority: createUnknownField(src, 'Mint authority unavailable'),
      freezeAuthority: createUnknownField(src, 'Freeze authority unavailable'),
      isMintAuthorityRevoked: createUnknownField(src, 'Revocation status unavailable'),
      isFreezeAuthorityRevoked: createUnknownField(src, 'Revocation status unavailable'),
      updateAuthority: createUnknownField(src, 'Update authority unavailable'),
    };
  }

  private createDefaultCreatorWallet(creatorAddress: string): CreatorWalletAnalysis {
    const src = 'token_analysis_service:default';
    return {
      address: creatorAddress
        ? createField(creatorAddress, { source: src })
        : createUnknownField(src, 'Creator address unavailable'),
      solBalance: createUnknownField(src, 'Creator balance unavailable'),
      exists: createUnknownField(src, 'Creator account status unavailable'),
      accountType: createUnknownField(src, 'Account type unavailable'),
    };
  }

  private createDefaultCreatorHoldings(creatorAddress: string): CreatorHoldingsAnalysis {
    const src = 'token_analysis_service:default';
    return {
      creatorAddress: creatorAddress
        ? createField(creatorAddress, { source: src })
        : createUnknownField(src, 'Creator address unavailable'),
      tokenBalance: createUnknownField(src, 'Creator token balance unavailable'),
      percentageOfSupply: createUnknownField(src, 'Creator percentage of supply unavailable'),
      hasSoldTokens: createUnknownField(src, 'Creator selling activity unavailable'),
      holdingStatus: createUnknownField(src, 'Creator holding status unavailable'),
    };
  }

  private createDefaultLargestHolders(): LargestHoldersAnalysis {
    const src = 'token_analysis_service:default';
    return {
      topHolders: createUnknownField(src, 'Holder accounts unavailable'),
      nonCurveTop10Percentage: createUnknownField(src, 'Holder concentration unavailable'),
      bondingCurvePercentage: createUnknownField(src, 'Bonding curve percentage unavailable'),
      hasHighConcentration: createUnknownField(src, 'Concentration risk unavailable'),
      observedAccountsCount: createUnknownField(src, 'Holder count unavailable'),
    };
  }

  private createDefaultHolderDistribution(): HolderDistributionAnalysis {
    const src = 'token_analysis_service:default';
    return {
      totalHoldersCount: createUnknownField(src, 'Holder count unavailable'),
      top5PercentShare: createUnknownField(src, 'Top 5% share unavailable'),
      top10PercentShare: createUnknownField(src, 'Top 10% share unavailable'),
      top20PercentShare: createUnknownField(src, 'Top 20% share unavailable'),
      concentrationLevel: createUnknownField(src, 'Concentration level unavailable'),
      giniCoefficient: createUnknownField(src, 'Gini coefficient unavailable'),
    };
  }

  private createDefaultLiquidityAndDepth(): LiquidityMarketDepthAnalysis {
    const src = 'token_analysis_service:default';
    return {
      liquiditySol: createUnknownField(src, 'Liquidity unavailable'),
      tokenReserves: createUnknownField(src, 'Token reserves unavailable'),
      virtualSolReserves: createUnknownField(src, 'Virtual SOL reserves unavailable'),
      virtualTokenReserves: createUnknownField(src, 'Virtual token reserves unavailable'),
      currentPriceSol: createUnknownField(src, 'Current price unavailable'),
      marketDepth: createUnknownField(src, 'Market depth unavailable'),
      bondingCurveProgressPct: createUnknownField(src, 'Bonding curve progress unavailable'),
    };
  }

  private createDefaultRecentActivity(): RecentActivityAnalysis {
    const src = 'token_analysis_service:default';
    return {
      observationWindowSeconds: createField(300, { source: src }),
      totalTransactions: createUnknownField(src, 'Transaction count unavailable'),
      buyCount: createUnknownField(src, 'Buy count unavailable'),
      sellCount: createUnknownField(src, 'Sell count unavailable'),
      buyVolumeSol: createUnknownField(src, 'Buy volume unavailable'),
      sellVolumeSol: createUnknownField(src, 'Sell volume unavailable'),
      netFlowSol: createUnknownField(src, 'Net flow unavailable'),
      recentTrades: createUnknownField(src, 'Recent trade history unavailable'),
    };
  }

  private createDefaultVolume(): TradingVolumeAnalysis {
    const src = 'token_analysis_service:default';
    return {
      totalVolumeSol: createUnknownField(src, 'Volume unavailable'),
      buyVolumeSol: createUnknownField(src, 'Buy volume unavailable'),
      sellVolumeSol: createUnknownField(src, 'Sell volume unavailable'),
      tradeCount: createUnknownField(src, 'Trade count unavailable'),
      windowSeconds: createField(86400, { source: src }),
    };
  }

  private createDefaultCreatorHistory(): CreatorHistoryAnalysis {
    const src = 'token_analysis_service:default';
    return {
      totalPastTokensLaunched: createUnknownField(src, 'Historical creator launches unavailable'),
      pastTokens: createUnknownField(src, 'Past token records unavailable'),
      walletAgeDays: createUnknownField(src, 'Wallet age unavailable'),
      firstSeenSlot: createUnknownField(src, 'First seen slot unavailable'),
      rugPullCount: createUnknownField(src, 'Rug pull count unavailable'),
      reputationTier: createUnknownField(src, 'Reputation tier unavailable'),
      reputationRiskScore: createUnknownField(src, 'Reputation risk score unavailable'),
    };
  }
}

export const tokenAnalysisService = new TokenAnalysisService();
