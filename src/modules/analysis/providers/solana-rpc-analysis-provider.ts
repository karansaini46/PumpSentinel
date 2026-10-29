import { z } from 'zod';
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
import { createField, createUnknownField } from '../analysis.types.js';
import type { RequestBudget } from '../budget/request-budget.js';
import { SolanaRpcClient } from '../../ingestion/transport/rpc-client.js';
import { dataReconciler } from '../reconciliation/data-reconciler.js';
import {
  walletEvidenceEngine,
  type RawWalletEvidenceItem,
} from '../wallet-evidence/wallet-evidence-engine.js';
import { logger } from '../../observability/logger.js';

// Schemas for Solana JSON-RPC method returns
const TokenSupplyRpcSchema = z.object({
  context: z.object({ slot: z.number().optional() }).optional(),
  value: z.object({
    amount: z.string(),
    decimals: z.number(),
    uiAmount: z.number().nullable().optional(),
    uiAmountString: z.string().optional(),
  }),
});

const LargestAccountsRpcSchema = z.object({
  context: z.object({ slot: z.number().optional() }).optional(),
  value: z.array(
    z.object({
      address: z.string(),
      amount: z.string(),
      decimals: z.number(),
      uiAmount: z.number().nullable().optional(),
      uiAmountString: z.string().optional(),
    }),
  ),
});

const AccountInfoRpcSchema = z.object({
  context: z.object({ slot: z.number().optional() }).optional(),
  value: z
    .object({
      lamports: z.number(),
      owner: z.string(),
      data: z.any().optional(),
      executable: z.boolean().optional(),
    })
    .nullable(),
});

const SignaturesRpcSchema = z.array(
  z.object({
    signature: z.string(),
    slot: z.number(),
    err: z.any().nullable().optional(),
    memo: z.string().nullable().optional(),
    blockTime: z.number().nullable().optional(),
  }),
);

const BalanceRpcSchema = z.object({
  context: z.object({ slot: z.number().optional() }).optional(),
  value: z.number(),
});

export class SolanaRpcAnalysisProvider implements ITokenAnalysisDataProvider {
  public readonly name = 'solana_rpc';
  private readonly rpcClient: SolanaRpcClient;

  constructor(rpcClient: SolanaRpcClient) {
    this.rpcClient = rpcClient;
  }

  /**
   * 1. Token mint and supply
   */
  public async fetchTokenSupply(
    mint: string,
    budget: RequestBudget,
  ): Promise<TokenSupplyAnalysis | null> {
    const sourceName = `${this.name}:getTokenSupply`;

    if (!budget.consume(1)) {
      return {
        mint: createField(mint, { source: sourceName, nature: 'DIRECT' }),
        supply: createUnknownField(sourceName, 'Request budget exhausted'),
        rawSupply: createUnknownField(sourceName, 'Request budget exhausted'),
        decimals: createUnknownField(sourceName, 'Request budget exhausted'),
        isInitialized: createUnknownField(sourceName, 'Request budget exhausted'),
      };
    }

    try {
      const res = await this.rpcClient.call(
        'getTokenSupply',
        [mint, { commitment: 'confirmed' }],
        TokenSupplyRpcSchema,
      );

      const decimals = res.value.decimals;
      const rawSupplyStr = res.value.amount;
      const uiSupply =
        res.value.uiAmount ?? (rawSupplyStr ? Number(rawSupplyStr) / Math.pow(10, decimals) : NaN);

      const supplyField = dataReconciler.reconcileNumeric(
        'supply',
        [{ source: sourceName, value: uiSupply, priority: 10, isDirect: true }],
        { min: 0 },
      );

      const decimalsField = dataReconciler.reconcileNumeric(
        'decimals',
        [{ source: sourceName, value: decimals, priority: 10, isDirect: true }],
        { min: 0, max: 18 },
      );

      return {
        mint: createField(mint, { source: sourceName, confidence: 'HIGH', nature: 'DIRECT' }),
        supply: supplyField,
        rawSupply: rawSupplyStr
          ? createField(rawSupplyStr, { source: sourceName, confidence: 'HIGH', nature: 'DIRECT' })
          : createUnknownField(sourceName, 'Raw supply string missing'),
        decimals: decimalsField,
        isInitialized: createField(true, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.debug({ mint, err: reason }, '[SolanaRpcAnalysisProvider] fetchTokenSupply failed');
      return {
        mint: createField(mint, { source: sourceName, nature: 'DIRECT' }),
        supply: createUnknownField(sourceName, `RPC error: ${reason}`),
        rawSupply: createUnknownField(sourceName, `RPC error: ${reason}`),
        decimals: createUnknownField(sourceName, `RPC error: ${reason}`),
        isInitialized: createUnknownField(sourceName, `RPC error: ${reason}`),
      };
    }
  }

  /**
   * 2. Token Authorities (mintAuthority, freezeAuthority)
   */
  public async fetchTokenAuthorities(
    mint: string,
    budget: RequestBudget,
  ): Promise<TokenAuthoritiesAnalysis | null> {
    const sourceName = `${this.name}:getAccountInfo`;

    if (!budget.consume(1)) {
      return {
        mintAuthority: createUnknownField(sourceName, 'Request budget exhausted'),
        freezeAuthority: createUnknownField(sourceName, 'Request budget exhausted'),
        isMintAuthorityRevoked: createUnknownField(sourceName, 'Request budget exhausted'),
        isFreezeAuthorityRevoked: createUnknownField(sourceName, 'Request budget exhausted'),
        updateAuthority: createUnknownField(sourceName, 'Request budget exhausted'),
      };
    }

    try {
      const res = await this.rpcClient.call(
        'getAccountInfo',
        [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }],
        AccountInfoRpcSchema,
      );

      if (!res.value || !res.value.data) {
        return {
          mintAuthority: createUnknownField(sourceName, 'Mint account not found on-chain'),
          freezeAuthority: createUnknownField(sourceName, 'Mint account not found on-chain'),
          isMintAuthorityRevoked: createUnknownField(sourceName, 'Mint account not found on-chain'),
          isFreezeAuthorityRevoked: createUnknownField(
            sourceName,
            'Mint account not found on-chain',
          ),
          updateAuthority: createUnknownField(sourceName, 'Mint account not found on-chain'),
        };
      }

      const parsedInfo = res.value.data?.parsed?.info;
      const mintAuthRaw = parsedInfo?.mintAuthority ?? null;
      const freezeAuthRaw = parsedInfo?.freezeAuthority ?? null;

      const mintReconciled = dataReconciler.reconcileAuthority('mintAuthority', [
        { source: sourceName, value: mintAuthRaw },
      ]);
      const freezeReconciled = dataReconciler.reconcileAuthority('freezeAuthority', [
        { source: sourceName, value: freezeAuthRaw },
      ]);

      return {
        mintAuthority: mintReconciled.authority,
        freezeAuthority: freezeReconciled.authority,
        isMintAuthorityRevoked: mintReconciled.isRevoked,
        isFreezeAuthorityRevoked: freezeReconciled.isRevoked,
        updateAuthority: createUnknownField(
          sourceName,
          'Metadata program inspect required for update authority',
        ),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.debug(
        { mint, err: reason },
        '[SolanaRpcAnalysisProvider] fetchTokenAuthorities failed',
      );
      return {
        mintAuthority: createUnknownField(sourceName, `RPC error: ${reason}`),
        freezeAuthority: createUnknownField(sourceName, `RPC error: ${reason}`),
        isMintAuthorityRevoked: createUnknownField(sourceName, `RPC error: ${reason}`),
        isFreezeAuthorityRevoked: createUnknownField(sourceName, `RPC error: ${reason}`),
        updateAuthority: createUnknownField(sourceName, `RPC error: ${reason}`),
      };
    }
  }

  /**
   * 3 & 5. Largest Holders Concentration & Holder Distribution
   */
  public async fetchHolderConcentration(
    mint: string,
    creatorAddress: string,
    bondingCurveAddress: string,
    budget: RequestBudget,
  ): Promise<{
    largestHolders: LargestHoldersAnalysis;
    distribution: HolderDistributionAnalysis;
  } | null> {
    const sourceName = `${this.name}:getTokenLargestAccounts`;

    if (!budget.consume(1)) {
      const unk = createUnknownField<number>(sourceName, 'Request budget exhausted');
      return {
        largestHolders: {
          topHolders: createUnknownField(sourceName, 'Request budget exhausted'),
          nonCurveTop10Percentage: unk,
          bondingCurvePercentage: unk,
          hasHighConcentration: createUnknownField(sourceName, 'Request budget exhausted'),
          observedAccountsCount: unk,
        },
        distribution: {
          totalHoldersCount: unk,
          top5PercentShare: unk,
          top10PercentShare: unk,
          top20PercentShare: unk,
          concentrationLevel: createUnknownField(sourceName, 'Request budget exhausted'),
          giniCoefficient: unk,
        },
      };
    }

    try {
      const res = await this.rpcClient.call(
        'getTokenLargestAccounts',
        [mint, { commitment: 'confirmed' }],
        LargestAccountsRpcSchema,
      );

      const accounts = res.value ?? [];
      if (accounts.length === 0) {
        const unk = createUnknownField<number>(sourceName, 'No holder accounts found');
        return {
          largestHolders: {
            topHolders: createField([], { source: sourceName, confidence: 'MEDIUM' }),
            nonCurveTop10Percentage: unk,
            bondingCurvePercentage: unk,
            hasHighConcentration: createUnknownField(sourceName, 'No accounts observed'),
            observedAccountsCount: createField(0, { source: sourceName, confidence: 'HIGH' }),
          },
          distribution: {
            totalHoldersCount: unk,
            top5PercentShare: unk,
            top10PercentShare: unk,
            top20PercentShare: unk,
            concentrationLevel: createUnknownField(sourceName, 'No accounts observed'),
            giniCoefficient: unk,
          },
        };
      }

      // Calculate total supply from sum or top holder shares
      const parsedAccounts: Array<{ address: string; amount: number }> = accounts.map((a) => {
        const amt = a.uiAmount ?? Number(a.amount) / Math.pow(10, a.decimals);
        return { address: a.address, amount: Number.isFinite(amt) ? amt : 0 };
      });

      const totalObserved = parsedAccounts.reduce((acc, a) => acc + a.amount, 0);

      // Build TopHolderEntry array
      const topHolders: TopHolderEntry[] = parsedAccounts.map((a) => {
        const isBondingCurve = a.address === bondingCurveAddress;
        const isCreator = a.address === creatorAddress;
        const percentage = totalObserved > 0 ? (a.amount / totalObserved) * 100 : 0;
        let label = 'Community';
        if (isBondingCurve) label = 'Bonding Curve';
        else if (isCreator) label = 'Creator';

        return {
          address: a.address,
          balance: Math.round(a.amount * 100) / 100,
          percentage: Math.round(percentage * 100) / 100,
          isBondingCurve,
          isCreator,
          label,
        };
      });

      // Filter non-bonding-curve for true community distribution
      const nonCurveHolders = topHolders.filter((h) => !h.isBondingCurve);
      const top10NonCurve = nonCurveHolders.slice(0, 10);
      const top10Percentage = top10NonCurve.reduce((acc, h) => acc + h.percentage, 0);

      const curveEntry = topHolders.find((h) => h.isBondingCurve);
      const bondingCurvePercentage = curveEntry ? curveEntry.percentage : 0;

      const hasHighConcentration =
        top10Percentage > 30 || nonCurveHolders.some((h) => h.percentage > 10);

      // Concentration level & Gini coefficient approximation
      const top5Share = topHolders.slice(0, 5).reduce((acc, h) => acc + h.percentage, 0);
      const top10Share = topHolders.slice(0, 10).reduce((acc, h) => acc + h.percentage, 0);
      const top20Share = topHolders.slice(0, 20).reduce((acc, h) => acc + h.percentage, 0);

      let concentrationLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
      if (top10Percentage > 50) concentrationLevel = 'CRITICAL';
      else if (top10Percentage > 30) concentrationLevel = 'HIGH';
      else if (top10Percentage > 15) concentrationLevel = 'MEDIUM';

      // Simplified Gini calculation on observed top holders
      const n = parsedAccounts.length;
      let gini = 0;
      if (n > 1 && totalObserved > 0) {
        const sorted = [...parsedAccounts].map((a) => a.amount).sort((a, b) => a - b);
        let diffSum = 0;
        for (let i = 0; i < n; i++) {
          const valI = sorted[i] ?? 0;
          for (let j = 0; j < n; j++) {
            const valJ = sorted[j] ?? 0;
            diffSum += Math.abs(valI - valJ);
          }
        }
        gini = diffSum / (2 * n * n * (totalObserved / n));
      }

      return {
        largestHolders: {
          topHolders: createField(topHolders, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
          nonCurveTop10Percentage: createField(Math.round(top10Percentage * 100) / 100, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'INFERRED',
          }),
          bondingCurvePercentage: createField(Math.round(bondingCurvePercentage * 100) / 100, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
          hasHighConcentration: createField(hasHighConcentration, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'INFERRED',
          }),
          observedAccountsCount: createField(accounts.length, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
        },
        distribution: {
          totalHoldersCount: createUnknownField(
            sourceName,
            'Total holder count across all on-chain accounts requires indexer; observed top 20 accounts',
          ),
          top5PercentShare: createField(Math.round(top5Share * 100) / 100, {
            source: sourceName,
            confidence: 'MEDIUM',
            nature: 'INFERRED',
          }),
          top10PercentShare: createField(Math.round(top10Share * 100) / 100, {
            source: sourceName,
            confidence: 'MEDIUM',
            nature: 'INFERRED',
          }),
          top20PercentShare: createField(Math.round(top20Share * 100) / 100, {
            source: sourceName,
            confidence: 'MEDIUM',
            nature: 'INFERRED',
          }),
          concentrationLevel: createField(concentrationLevel, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'INFERRED',
          }),
          giniCoefficient: createField(Math.round(gini * 1000) / 1000, {
            source: sourceName,
            confidence: 'MEDIUM',
            nature: 'INFERRED',
          }),
        },
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.debug(
        { mint, err: reason },
        '[SolanaRpcAnalysisProvider] fetchHolderConcentration failed',
      );
      const unk = createUnknownField<number>(sourceName, `RPC error: ${reason}`);
      return {
        largestHolders: {
          topHolders: createUnknownField(sourceName, `RPC error: ${reason}`),
          nonCurveTop10Percentage: unk,
          bondingCurvePercentage: unk,
          hasHighConcentration: createUnknownField(sourceName, `RPC error: ${reason}`),
          observedAccountsCount: unk,
        },
        distribution: {
          totalHoldersCount: unk,
          top5PercentShare: unk,
          top10PercentShare: unk,
          top20PercentShare: unk,
          concentrationLevel: createUnknownField(sourceName, `RPC error: ${reason}`),
          giniCoefficient: unk,
        },
      };
    }
  }

  /**
   * 4. Creator Wallet
   */
  public async fetchCreatorWallet(
    creatorAddress: string,
    budget: RequestBudget,
  ): Promise<CreatorWalletAnalysis | null> {
    const sourceName = `${this.name}:getBalance`;

    if (!budget.consume(1)) {
      return {
        address: createField(creatorAddress, { source: sourceName, nature: 'DIRECT' }),
        solBalance: createUnknownField(sourceName, 'Request budget exhausted'),
        exists: createUnknownField(sourceName, 'Request budget exhausted'),
        accountType: createUnknownField(sourceName, 'Request budget exhausted'),
      };
    }

    try {
      const res = await this.rpcClient.call(
        'getBalance',
        [creatorAddress, { commitment: 'confirmed' }],
        BalanceRpcSchema,
      );

      const solBalance = res.value / 1e9;
      return {
        address: createField(creatorAddress, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        solBalance: createField(Math.round(solBalance * 10000) / 10000, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        exists: createField(true, { source: sourceName, confidence: 'HIGH', nature: 'DIRECT' }),
        accountType: createField('SYSTEM_ACCOUNT', {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'INFERRED',
        }),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        address: createField(creatorAddress, { source: sourceName, nature: 'DIRECT' }),
        solBalance: createUnknownField(sourceName, `RPC error: ${reason}`),
        exists: createUnknownField(sourceName, `RPC error: ${reason}`),
        accountType: createUnknownField(sourceName, `RPC error: ${reason}`),
      };
    }
  }

  /**
   * 4. Creator's Token Holdings
   */
  public async fetchCreatorHoldings(
    mint: string,
    creatorAddress: string,
    totalSupply: number | null,
    budget: RequestBudget,
  ): Promise<CreatorHoldingsAnalysis | null> {
    const sourceName = `${this.name}:getTokenLargestAccounts`;

    // Attempt to inspect largest accounts (often cached or inexpensive)
    if (!budget.consume(1)) {
      return {
        creatorAddress: createField(creatorAddress, { source: sourceName, nature: 'DIRECT' }),
        tokenBalance: createUnknownField(sourceName, 'Request budget exhausted'),
        percentageOfSupply: createUnknownField(sourceName, 'Request budget exhausted'),
        hasSoldTokens: createUnknownField(sourceName, 'Request budget exhausted'),
        holdingStatus: createUnknownField(sourceName, 'Request budget exhausted'),
      };
    }

    try {
      const res = await this.rpcClient.call(
        'getTokenLargestAccounts',
        [mint, { commitment: 'confirmed' }],
        LargestAccountsRpcSchema,
      );

      const creatorAccount = res.value.find((a) => a.address === creatorAddress);
      if (creatorAccount) {
        const balance =
          creatorAccount.uiAmount ??
          Number(creatorAccount.amount) / Math.pow(10, creatorAccount.decimals);
        const pct = totalSupply && totalSupply > 0 ? (balance / totalSupply) * 100 : 0;
        return {
          creatorAddress: createField(creatorAddress, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
          tokenBalance: createField(balance, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
          percentageOfSupply: createField(Math.round(pct * 100) / 100, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'INFERRED',
          }),
          hasSoldTokens: createField(false, {
            source: sourceName,
            confidence: 'MEDIUM',
            nature: 'INFERRED',
          }),
          holdingStatus: createField('HOLDING', {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'INFERRED',
          }),
        };
      }

      // Not found in top 20 holders -> holding is either 0 or very small
      return {
        creatorAddress: createField(creatorAddress, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        tokenBalance: createField(0, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
          reason: 'Creator wallet not in top 20 accounts; holding <= 0.1%',
        }),
        percentageOfSupply: createField(0, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
        }),
        hasSoldTokens: createField(true, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
          reason: 'Creator does not hold substantial balance in top 20 accounts',
        }),
        holdingStatus: createField('REDUCED', {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
        }),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        creatorAddress: createField(creatorAddress, { source: sourceName, nature: 'DIRECT' }),
        tokenBalance: createUnknownField(sourceName, `RPC error: ${reason}`),
        percentageOfSupply: createUnknownField(sourceName, `RPC error: ${reason}`),
        hasSoldTokens: createUnknownField(sourceName, `RPC error: ${reason}`),
        holdingStatus: createUnknownField(sourceName, `RPC error: ${reason}`),
      };
    }
  }

  /**
   * 6. Recent Buy and Sell Activity
   */
  public async fetchRecentActivity(
    mint: string,
    budget: RequestBudget,
  ): Promise<RecentActivityAnalysis | null> {
    const sourceName = `${this.name}:getSignaturesForAddress`;

    if (!budget.consume(1)) {
      const unk = createUnknownField<number>(sourceName, 'Request budget exhausted');
      return {
        observationWindowSeconds: createField(300, { source: sourceName, confidence: 'HIGH' }),
        totalTransactions: unk,
        buyCount: unk,
        sellCount: unk,
        buyVolumeSol: unk,
        sellVolumeSol: unk,
        netFlowSol: unk,
        recentTrades: createUnknownField(sourceName, 'Request budget exhausted'),
      };
    }

    try {
      const signatures = await this.rpcClient.call(
        'getSignaturesForAddress',
        [mint, { limit: 15, commitment: 'confirmed' }],
        SignaturesRpcSchema,
      );

      const totalTransactions = signatures.length;
      return {
        observationWindowSeconds: createField(300, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        totalTransactions: createField(totalTransactions, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        buyCount: createUnknownField(
          sourceName,
          'Parsed instruction decoding required for buy/sell segregation',
        ),
        sellCount: createUnknownField(
          sourceName,
          'Parsed instruction decoding required for buy/sell segregation',
        ),
        buyVolumeSol: createUnknownField(
          sourceName,
          'Parsed transaction amount required for buy volume',
        ),
        sellVolumeSol: createUnknownField(
          sourceName,
          'Parsed transaction amount required for sell volume',
        ),
        netFlowSol: createUnknownField(
          sourceName,
          'Requires decoded buy and sell transaction flows',
        ),
        recentTrades: createField([], {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'DIRECT',
          reason: `Found ${signatures.length} recent signatures`,
        }),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const unk = createUnknownField<number>(sourceName, `RPC error: ${reason}`);
      return {
        observationWindowSeconds: createField(300, { source: sourceName }),
        totalTransactions: unk,
        buyCount: unk,
        sellCount: unk,
        buyVolumeSol: unk,
        sellVolumeSol: unk,
        netFlowSol: unk,
        recentTrades: createUnknownField(sourceName, `RPC error: ${reason}`),
      };
    }
  }

  /**
   * 7. Liquidity and Market Depth
   */
  public async fetchLiquidityAndDepth(
    _mint: string,
    bondingCurveAddress: string,
    budget: RequestBudget,
  ): Promise<LiquidityMarketDepthAnalysis | null> {
    const sourceName = `${this.name}:getAccountInfo`;

    if (!bondingCurveAddress || bondingCurveAddress.trim() === '') {
      const unk = createUnknownField<number>(sourceName, 'No bonding curve address provided');
      return {
        liquiditySol: unk,
        tokenReserves: unk,
        virtualSolReserves: unk,
        virtualTokenReserves: unk,
        currentPriceSol: unk,
        marketDepth: createUnknownField(sourceName, 'No bonding curve address provided'),
        bondingCurveProgressPct: unk,
      };
    }

    if (!budget.consume(1)) {
      const unk = createUnknownField<number>(sourceName, 'Request budget exhausted');
      return {
        liquiditySol: unk,
        tokenReserves: unk,
        virtualSolReserves: unk,
        virtualTokenReserves: unk,
        currentPriceSol: unk,
        marketDepth: createUnknownField(sourceName, 'Request budget exhausted'),
        bondingCurveProgressPct: unk,
      };
    }

    try {
      const res = await this.rpcClient.call(
        'getAccountInfo',
        [bondingCurveAddress, { commitment: 'confirmed' }],
        AccountInfoRpcSchema,
      );

      if (!res.value) {
        const unk = createUnknownField<number>(sourceName, 'Bonding curve account not found');
        return {
          liquiditySol: unk,
          tokenReserves: unk,
          virtualSolReserves: unk,
          virtualTokenReserves: unk,
          currentPriceSol: unk,
          marketDepth: createUnknownField(sourceName, 'Bonding curve account not found'),
          bondingCurveProgressPct: unk,
        };
      }

      const realSolLamports = res.value.lamports;
      const realSol = realSolLamports / 1e9;

      // Pump.fun standard initial parameters:
      // virtualSolReserves = 30 SOL, virtualTokenReserves = 1,073,000,000
      const virtualSol = 30.0 + realSol;
      const virtualTokens = 1_073_000_000;
      const currentPriceSol = virtualSol / virtualTokens;
      const targetSol = 85.0; // Standard pump.fun graduation target
      const progressPct = Math.min(100, Math.max(0, (realSol / targetSol) * 100));

      // Calculate market depth / price impact for orders: 0.5 SOL, 1.0 SOL, 5.0 SOL
      const k = virtualSol * virtualTokens;
      const depthBuckets: MarketDepthBucket[] = [0.5, 1.0, 5.0].map((orderSol) => {
        const newVirtualSol = virtualSol + orderSol;
        const newVirtualTokens = k / newVirtualSol;
        const tokensOut = virtualTokens - newVirtualTokens;
        const effectivePrice = orderSol / tokensOut;
        const priceImpactPct = ((effectivePrice - currentPriceSol) / currentPriceSol) * 100;
        return {
          orderSolAmount: orderSol,
          estimatedPriceImpactPct: Math.round(priceImpactPct * 100) / 100,
          estimatedTokensOut: Math.round(tokensOut * 100) / 100,
        };
      });

      return {
        liquiditySol: createField(Math.round(realSol * 1000) / 1000, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        tokenReserves: createField(virtualTokens, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
        }),
        virtualSolReserves: createField(virtualSol, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
        }),
        virtualTokenReserves: createField(virtualTokens, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
        }),
        currentPriceSol: createField(currentPriceSol, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'INFERRED',
        }),
        marketDepth: createField(depthBuckets, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'INFERRED',
        }),
        bondingCurveProgressPct: createField(Math.round(progressPct * 100) / 100, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'INFERRED',
        }),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const unk = createUnknownField<number>(sourceName, `RPC error: ${reason}`);
      return {
        liquiditySol: unk,
        tokenReserves: unk,
        virtualSolReserves: unk,
        virtualTokenReserves: unk,
        currentPriceSol: unk,
        marketDepth: createUnknownField(sourceName, `RPC error: ${reason}`),
        bondingCurveProgressPct: unk,
      };
    }
  }

  /**
   * 8. Trading Volume
   */
  public async fetchTradingVolume(
    _mint: string,
    _budget: RequestBudget,
  ): Promise<TradingVolumeAnalysis | null> {
    const sourceName = `${this.name}:volume`;
    // Pure RPC without archival indexer cannot compute complete 24h historical volume accurately.
    // Represent unavailable volume as UNKNOWN, never as zero.
    return {
      totalVolumeSol: createUnknownField(
        sourceName,
        'Aggregated 24h trading volume requires indexer integration',
      ),
      buyVolumeSol: createUnknownField(
        sourceName,
        'Aggregated buy volume requires indexer integration',
      ),
      sellVolumeSol: createUnknownField(
        sourceName,
        'Aggregated sell volume requires indexer integration',
      ),
      tradeCount: createUnknownField(sourceName, 'Trade count requires indexer integration'),
      windowSeconds: createField(86400, { source: sourceName, confidence: 'HIGH' }),
    };
  }

  /**
   * 11. Historical Creator Activity
   */
  public async fetchCreatorHistory(
    creatorAddress: string,
    budget: RequestBudget,
  ): Promise<CreatorHistoryAnalysis | null> {
    const sourceName = `${this.name}:creatorHistory`;

    if (!budget.consume(1)) {
      const unk = createUnknownField<number>(sourceName, 'Request budget exhausted');
      return {
        totalPastTokensLaunched: unk,
        pastTokens: createUnknownField(sourceName, 'Request budget exhausted'),
        walletAgeDays: unk,
        firstSeenSlot: unk,
        rugPullCount: unk,
        reputationTier: createUnknownField(sourceName, 'Request budget exhausted'),
        reputationRiskScore: unk,
      };
    }

    try {
      const signatures = await this.rpcClient.call(
        'getSignaturesForAddress',
        [creatorAddress, { limit: 50, commitment: 'confirmed' }],
        SignaturesRpcSchema,
      );

      if (signatures.length === 0) {
        return {
          totalPastTokensLaunched: createField(0, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
          pastTokens: createField([], { source: sourceName, confidence: 'HIGH', nature: 'DIRECT' }),
          walletAgeDays: createField(0, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
          firstSeenSlot: createUnknownField(sourceName, 'No past transactions observed'),
          rugPullCount: createField(0, {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'DIRECT',
          }),
          reputationTier: createField('FRESH_WALLET', {
            source: sourceName,
            confidence: 'HIGH',
            nature: 'INFERRED',
          }),
          reputationRiskScore: createField(40, {
            source: sourceName,
            confidence: 'MEDIUM',
            nature: 'INFERRED',
            reason: 'Brand new wallet with no prior transaction history',
          }),
        };
      }

      // Wallet age in days
      const times = signatures
        .map((s) => s.blockTime)
        .filter((t): t is number => typeof t === 'number' && t > 0);

      let walletAgeDays = 0;
      if (times.length > 0) {
        const oldest = Math.min(...times);
        const newest = Math.max(...times);
        walletAgeDays = Math.max(0, Math.round(((newest - oldest) / (3600 * 24)) * 10) / 10);
      }

      const lastSig = signatures[signatures.length - 1];
      const firstSeenSlot = lastSig ? lastSig.slot : 0;

      // Classify reputation based on observed signatures
      let tier: CreatorHistoryAnalysis['reputationTier']['value'] = 'ESTABLISHED_SAFE';
      let riskScore = 15;

      if (walletAgeDays < 1) {
        tier = 'FRESH_WALLET';
        riskScore = 50;
      } else if (signatures.length > 40) {
        tier = 'PROLIFIC_CREATOR';
        riskScore = 30;
      }

      return {
        totalPastTokensLaunched: createUnknownField(
          sourceName,
          'Full history of launched tokens requires SPL token creation parser or indexer',
        ),
        pastTokens: createField([], { source: sourceName, confidence: 'MEDIUM' }),
        walletAgeDays: createField(walletAgeDays, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        firstSeenSlot: createField(firstSeenSlot, {
          source: sourceName,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        rugPullCount: createUnknownField(
          sourceName,
          'Historical rug-pull rate requires archival token inspection',
        ),
        reputationTier: createField(tier, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
        }),
        reputationRiskScore: createField(riskScore, {
          source: sourceName,
          confidence: 'MEDIUM',
          nature: 'INFERRED',
        }),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const unk = createUnknownField<number>(sourceName, `RPC error: ${reason}`);
      return {
        totalPastTokensLaunched: unk,
        pastTokens: createUnknownField(sourceName, `RPC error: ${reason}`),
        walletAgeDays: unk,
        firstSeenSlot: unk,
        rugPullCount: unk,
        reputationTier: createUnknownField(sourceName, `RPC error: ${reason}`),
        reputationRiskScore: unk,
      };
    }
  }

  /**
   * 10. Related Wallet Activity
   * Enforces: "Do not claim that wallets are connected merely because they bought the same token."
   */
  public async fetchRelatedWallets(
    targetWallet: string,
    candidateWallets: string[],
    budget: RequestBudget,
  ): Promise<RelatedWalletsAnalysis | null> {
    // When no candidates or no budget, return clean empty analysis
    if (candidateWallets.length === 0 || !budget.canConsume(1)) {
      return walletEvidenceEngine.createEmptyAnalysis(
        budget.canConsume(1) ? 'No candidate wallets provided' : 'Request budget limit reached',
      );
    }

    budget.consume(1);
    // Build raw candidate evidence with strict non-evidence filtering
    const rawEvidences: RawWalletEvidenceItem[] = candidateWallets.map((w) => ({
      walletA: targetWallet,
      walletB: w,
      type: 'SAME_TOKEN_TRADED', // Specifically flagged to verify non-evidence filtering
      description: 'Both wallets interacted with the same token mint',
    }));

    return walletEvidenceEngine.evaluateLinks(targetWallet, rawEvidences);
  }
}
