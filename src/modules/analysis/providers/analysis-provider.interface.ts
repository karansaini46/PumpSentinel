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
} from '../analysis.types.js';
import type { RequestBudget } from '../budget/request-budget.js';

export interface ITokenAnalysisDataProvider {
  readonly name: string;

  fetchTokenSupply(mint: string, budget: RequestBudget): Promise<TokenSupplyAnalysis | null>;

  fetchTokenAuthorities(
    mint: string,
    budget: RequestBudget,
  ): Promise<TokenAuthoritiesAnalysis | null>;

  fetchHolderConcentration(
    mint: string,
    creatorAddress: string,
    bondingCurveAddress: string,
    budget: RequestBudget,
  ): Promise<{
    largestHolders: LargestHoldersAnalysis;
    distribution: HolderDistributionAnalysis;
  } | null>;

  fetchCreatorWallet(
    creatorAddress: string,
    budget: RequestBudget,
  ): Promise<CreatorWalletAnalysis | null>;

  fetchCreatorHoldings(
    mint: string,
    creatorAddress: string,
    totalSupply: number | null,
    budget: RequestBudget,
  ): Promise<CreatorHoldingsAnalysis | null>;

  fetchRecentActivity(mint: string, budget: RequestBudget): Promise<RecentActivityAnalysis | null>;

  fetchLiquidityAndDepth(
    mint: string,
    bondingCurveAddress: string,
    budget: RequestBudget,
  ): Promise<LiquidityMarketDepthAnalysis | null>;

  fetchTradingVolume(mint: string, budget: RequestBudget): Promise<TradingVolumeAnalysis | null>;

  fetchCreatorHistory(
    creatorAddress: string,
    budget: RequestBudget,
  ): Promise<CreatorHistoryAnalysis | null>;

  fetchRelatedWallets(
    targetWallet: string,
    candidateWallets: string[],
    budget: RequestBudget,
  ): Promise<RelatedWalletsAnalysis | null>;
}
