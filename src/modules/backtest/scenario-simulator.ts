import type { HistoricalTokenScenario, BacktestPriceQuote } from './backtest.types.js';
import type { TokenAnalysisReport } from '../analysis/analysis.types.js';
import { createField } from '../analysis/analysis.types.js';

/**
 * Helper to build an analysis report with tailored parameters for scenarios.
 */
export function buildMockAnalysisReport(params: {
  mint: string;
  symbol?: string;
  creator: string;
  timestamp: number;
  initialLiquiditySol: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10Percentage: number | null;
  creatorHoldingPercentage: number | null;
  hasSybilCluster: boolean;
  creatorWalletAgeDays?: number;
  creatorKnownScamsCount?: number;
  dataCompletenessPct?: number;
  isStale?: boolean;
}): TokenAnalysisReport {
  const source = 'scenario_simulator';
  const age = params.isStale ? 120000 : 0;
  const quoteTimestamp = params.timestamp - age;

  const top10Val = params.top10Percentage ?? 20;
  const top10Field = createField(top10Val, {
    source,
    observedAt: new Date(quoteTimestamp),
  });

  const creatorHoldingVal = params.creatorHoldingPercentage ?? 4;
  const creatorHoldingField = createField(creatorHoldingVal, {
    source,
    observedAt: new Date(quoteTimestamp),
  });

  return {
    mint: params.mint,
    symbol: params.symbol ?? 'TOKEN',
    analyzedAt: new Date(params.timestamp),
    executionDurationMs: 25,
    isCacheHit: false,
    budgetUsed: {
      rpcRequestsUsed: 4,
      rpcBudgetLimit: 20,
      budgetExhausted: false,
    },
    supply: {
      mint: createField(params.mint, { source }),
      supply: createField(1_000_000_000, { source }),
      rawSupply: createField('1000000000000000', { source }),
      decimals: createField(6, { source }),
      isInitialized: createField(true, { source }),
    },
    creatorWallet: {
      address: createField(params.creator, { source }),
      solBalance: createField(15.0, { source }),
      exists: createField(true, { source }),
      accountType: createField('SYSTEM_ACCOUNT', { source }),
    },
    holderDistribution: {
      totalHoldersCount: createField(150, { source }),
      top5PercentShare: createField(top10Val * 0.7, { source }),
      top10PercentShare: top10Field,
      top20PercentShare: createField(Math.min(top10Val * 1.3, 100), { source }),
      concentrationLevel: createField(top10Val > 30 ? 'HIGH' : 'LOW', { source }),
      giniCoefficient: createField(0.35, { source }),
    },
    creatorHoldings: {
      creatorAddress: createField(params.creator, { source }),
      tokenBalance: createField(creatorHoldingVal * 10_000_000, { source }),
      percentageOfSupply: creatorHoldingField,
      hasSoldTokens: createField(false, { source }),
      holdingStatus: createField(creatorHoldingVal > 0 ? 'HOLDING' : 'NEVER_HELD', { source }),
    },
    largestHolders: {
      topHolders: createField([], { source }),
      nonCurveTop10Percentage: top10Field,
      bondingCurvePercentage: createField(20.0, { source }),
      hasHighConcentration: createField(top10Val > 30, { source }),
      observedAccountsCount: createField(10, { source }),
    },
    recentActivity: {
      observationWindowSeconds: createField(3600, { source }),
      totalTransactions: createField(15, { source }),
      buyCount: createField(12, { source }),
      sellCount: createField(3, { source }),
      buyVolumeSol: createField(25.0, { source }),
      sellVolumeSol: createField(5.0, { source }),
      netFlowSol: createField(20.0, { source }),
      recentTrades: createField([], { source }),
    },
    liquidityAndDepth: {
      liquiditySol: createField(params.initialLiquiditySol, {
        source,
        observedAt: new Date(quoteTimestamp),
      }),
      tokenReserves: createField(800_000_000, { source }),
      virtualSolReserves: createField(params.initialLiquiditySol + 30, { source }),
      virtualTokenReserves: createField(1_073_000_000, { source }),
      currentPriceSol: createField(0.0001, { source }),
      marketDepth: createField([], { source }),
      bondingCurveProgressPct: createField(15.0, { source }),
    },
    volume: {
      totalVolumeSol: createField(45.0, { source }),
      buyVolumeSol: createField(35.0, { source }),
      sellVolumeSol: createField(10.0, { source }),
      tradeCount: createField(30, { source }),
      windowSeconds: createField(3600, { source }),
    },
    authorities: {
      mintAuthority: createField(params.mintAuthorityRevoked ? null : 'DevActiveMintAuthority', {
        source,
      }),
      freezeAuthority: createField(
        params.freezeAuthorityRevoked ? null : 'DevActiveFreezeAuthority',
        { source },
      ),
      isMintAuthorityRevoked: createField(params.mintAuthorityRevoked, { source }),
      isFreezeAuthorityRevoked: createField(params.freezeAuthorityRevoked, { source }),
      updateAuthority: createField(null, { source }),
    },
    relatedWallets: {
      linkedWallets: createField([], { source }),
      connectedWalletCount: createField(params.hasSybilCluster ? 5 : 0, { source }),
      dismissedNonEvidenceLinks: createField([], { source }),
      hasSybilCluster: createField(params.hasSybilCluster, { source }),
    },
    creatorHistory: {
      totalPastTokensLaunched: createField(1, { source }),
      pastTokens: createField([], { source }),
      walletAgeDays: createField(params.creatorWalletAgeDays ?? 45, { source }),
      firstSeenSlot: createField(200_000_000, { source }),
      rugPullCount: createField(params.creatorKnownScamsCount ?? 0, { source }),
      reputationTier: createField(
        (params.creatorKnownScamsCount ?? 0) > 0 ? 'SUSPECTED_SERIAL_RUGGER' : 'ESTABLISHED_SAFE',
        { source },
      ),
      reputationRiskScore: createField((params.creatorKnownScamsCount ?? 0) > 0 ? 95 : 15, {
        source,
      }),
    },
    overallSummary: {
      dataCompletenessPct: params.dataCompletenessPct ?? 90,
      confidenceWeightedScore: 0.9,
      staleFieldCount: params.isStale ? 2 : 0,
      contradictoryFieldCount: 0,
      unknownFieldCount: 0,
    },
  };
}

/**
 * Factory creating specific stress scenarios.
 */
export class ScenarioSimulator {
  public static buildMockAnalysisReport = buildMockAnalysisReport;

  /**
   * 1. Rapid Price Crash: Token passes initial safety, enters trade, then flash dumps -75% in 15 seconds.
   */
  public static createRapidCrashScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'Crash11111111111111111111111111111111111111';
    const creator = 'DevCrash11111111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 30.0 },
      { timestamp: baseTimestamp + 3000, priceSol: 0.000102, liquiditySol: 30.5 },
      { timestamp: baseTimestamp + 6000, priceSol: 0.000105, liquiditySol: 31.0 },
      // Sudden catastrophic drop
      {
        timestamp: baseTimestamp + 9000,
        priceSol: 0.00006,
        liquiditySol: 18.0,
        priceImpactPct: 8.0,
      },
      {
        timestamp: baseTimestamp + 12000,
        priceSol: 0.00003,
        liquiditySol: 12.0,
        priceImpactPct: 15.0,
      },
      {
        timestamp: baseTimestamp + 15000,
        priceSol: 0.000025,
        liquiditySol: 8.0,
        priceImpactPct: 20.0,
      },
    ];

    return {
      mint,
      symbol: 'CRASH',
      name: '[STRESS] Rapid Flash Crash Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'RAPID_PRICE_CRASH',
      description: 'Clean token that suffers sudden market crash of -75% within 15 seconds.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Rapid Flash Crash Token',
        symbol: 'CRASH',
        uri: 'https://ipfs.io/ipfs/crash',
        bondingCurve: 'CurveCrash11111111111111111111111111111111',
        signature: 'sig_crash_1',
        slot: 300000001,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 18.0,
        creatorHoldingPercentage: 4.0,
        hasSybilCluster: false,
      }),
      priceHistory,
    };
  }

  /**
   * 2. Rug Pull: Creator dumps 45% of supply, pulls liquidity to zero. Ground truth: RUG_PULL.
   */
  public static createRugPullScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'Rug11111111111111111111111111111111111111111';
    const creator = 'DevRugScam11111111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 25.0 },
      { timestamp: baseTimestamp + 5000, priceSol: 0.00008, liquiditySol: 20.0 },
      // Dev rug pull: complete liquidity dump
      {
        timestamp: baseTimestamp + 8000,
        priceSol: 0.000001,
        liquiditySol: 0.2,
        priceImpactPct: 95.0,
      },
      {
        timestamp: baseTimestamp + 12000,
        priceSol: 0.0000001,
        liquiditySol: 0.05,
        priceImpactPct: 99.0,
      },
    ];

    return {
      mint,
      symbol: 'RUGSCAM',
      name: '[STRESS] Malicious Rugpull Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'RUG_PULL',
      scenarioType: 'RUG_PULL',
      description: 'Dev wallet holds 45% supply and unrevoked mint authority, dumps to zero.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Malicious Rugpull Token',
        symbol: 'RUGSCAM',
        uri: 'https://ipfs.io/ipfs/rug',
        bondingCurve: 'CurveRug111111111111111111111111111111111',
        signature: 'sig_rug_1',
        slot: 300000002,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 25.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 25.0,
        mintAuthorityRevoked: false, // Scam flag
        freezeAuthorityRevoked: false, // Scam flag
        top10Percentage: 62.0, // Scam flag
        creatorHoldingPercentage: 45.0, // Scam flag (>10%)
        hasSybilCluster: true, // Scam flag
        creatorKnownScamsCount: 3,
      }),
      priceHistory,
    };
  }

  /**
   * 3. High Slippage: Thin pool and large price impact.
   */
  public static createHighSlippageScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'Slip111111111111111111111111111111111111111';
    const creator = 'DevSlip11111111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 16.0, priceImpactPct: 12.0 },
      {
        timestamp: baseTimestamp + 10000,
        priceSol: 0.00011,
        liquiditySol: 16.2,
        priceImpactPct: 14.0,
      },
      {
        timestamp: baseTimestamp + 20000,
        priceSol: 0.00012,
        liquiditySol: 16.5,
        priceImpactPct: 15.0,
      },
    ];

    return {
      mint,
      symbol: 'SLIP',
      name: '[STRESS] High Slippage Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'HIGH_SLIPPAGE',
      description: 'Thin order book liquidity incurring high price impact on entries and exits.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] High Slippage Token',
        symbol: 'SLIP',
        uri: 'https://ipfs.io/ipfs/slip',
        bondingCurve: 'CurveSlip11111111111111111111111111111111',
        signature: 'sig_slip_1',
        slot: 300000003,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 16.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 16.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 22.0,
        creatorHoldingPercentage: 5.0,
        hasSybilCluster: false,
      }),
      priceHistory,
    };
  }

  /**
   * 4. Low Liquidity: Pool liquidity below minimum threshold (3 SOL vs 15 SOL minimum).
   */
  public static createLowLiquidityScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'LowLiq111111111111111111111111111111111111';
    const creator = 'DevLowLiq111111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.00001, liquiditySol: 3.0 },
      { timestamp: baseTimestamp + 5000, priceSol: 0.00001, liquiditySol: 3.0 },
    ];

    return {
      mint,
      symbol: 'LOWLIQ',
      name: '[STRESS] Low Liquidity Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'RUG_PULL',
      scenarioType: 'LOW_LIQUIDITY',
      description: 'Initial liquidity is only 3 SOL, triggering immediate risk gate rejection.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Low Liquidity Token',
        symbol: 'LOWLIQ',
        uri: 'https://ipfs.io/ipfs/lowliq',
        bondingCurve: 'CurveLowLiq11111111111111111111111111111',
        signature: 'sig_lowliq_1',
        slot: 300000004,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 3.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 3.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 20.0,
        creatorHoldingPercentage: 5.0,
        hasSybilCluster: false,
      }),
      priceHistory,
    };
  }

  /**
   * 5. Failed Exits: Simulated exit execution drops or fails 2 times, testing EXIT_PENDING status.
   */
  public static createFailedExitScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'FailExit11111111111111111111111111111111111';
    const creator = 'DevFailExit1111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 30.0 },
      { timestamp: baseTimestamp + 10000, priceSol: 0.000085, liquiditySol: 28.0 }, // -15% triggers stop-loss
      { timestamp: baseTimestamp + 20000, priceSol: 0.00008, liquiditySol: 26.0 },
    ];

    return {
      mint,
      symbol: 'FAILExit',
      name: '[STRESS] Failed Exit Simulation Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'FAILED_EXIT',
      description: 'Simulates transaction drop during exit, marking position as EXIT_PENDING.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Failed Exit Simulation Token',
        symbol: 'FAILExit',
        uri: 'https://ipfs.io/ipfs/failexit',
        bondingCurve: 'CurveFailExit11111111111111111111111111111',
        signature: 'sig_failexit_1',
        slot: 300000005,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 15.0,
        creatorHoldingPercentage: 3.0,
        hasSybilCluster: false,
      }),
      priceHistory,
      adversarialFlags: {
        simulateFailedExit: true,
        failCountBeforeExit: 2,
      },
    };
  }

  /**
   * 6. Missing and Stale Data: Stale market quotes (>60s old) or missing critical evidence.
   */
  public static createMissingAndStaleDataScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'Stale1111111111111111111111111111111111111';
    const creator = 'DevStale111111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp - 90000, priceSol: 0.0001, liquiditySol: 30.0 }, // 90s stale
    ];

    return {
      mint,
      symbol: 'STALE',
      name: '[STRESS] Stale and Missing Data Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'RUG_PULL',
      scenarioType: 'MISSING_AND_STALE_DATA',
      description: 'Market data is 90 seconds old and data completeness is only 40%.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Stale and Missing Data Token',
        symbol: 'STALE',
        uri: '', // Missing URI
        bondingCurve: 'CurveStale11111111111111111111111111111111',
        signature: 'sig_stale_1',
        slot: 300000006,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: null, // Missing field
        creatorHoldingPercentage: null, // Missing field
        hasSybilCluster: false,
        dataCompletenessPct: 40.0, // Fails completeness threshold
        isStale: true,
      }),
      priceHistory,
      adversarialFlags: {
        staleQuoteAgeMs: 90000,
      },
    };
  }

  /**
   * 7. Duplicate Events: Identical signatures arriving repeatedly to verify deduplication.
   */
  public static createDuplicateEventsScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'Dup1111111111111111111111111111111111111111';
    const creator = 'DevDup111111111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 30.0 },
      { timestamp: baseTimestamp + 10000, priceSol: 0.000105, liquiditySol: 31.0 },
    ];

    return {
      mint,
      symbol: 'DUP',
      name: '[STRESS] Duplicate Events Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'DUPLICATE_EVENTS',
      description: 'Simulates 5 replayed duplicate updates with identical transaction signature.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Duplicate Events Token',
        symbol: 'DUP',
        uri: 'https://ipfs.io/ipfs/dup',
        bondingCurve: 'CurveDup111111111111111111111111111111111',
        signature: 'sig_duplicate_target_signature',
        slot: 300000007,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 20.0,
        creatorHoldingPercentage: 5.0,
        hasSybilCluster: false,
      }),
      priceHistory,
      adversarialFlags: {
        duplicateCount: 5,
      },
    };
  }

  /**
   * 8. Standard Successful Pump: Safe token that gains +35% and exits on take-profit.
   */
  public static createStandardPumpScenario(
    baseTimestamp: number,
    index = 1,
  ): HistoricalTokenScenario {
    const mint = `SafePump${index}1111111111111111111111111111111111`.slice(0, 44);
    const creator = `DevSafePump${index}11111111111111111111111111111111`.slice(0, 44);

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 30.0 },
      { timestamp: baseTimestamp + 15000, priceSol: 0.000108, liquiditySol: 32.0 },
      { timestamp: baseTimestamp + 30000, priceSol: 0.000118, liquiditySol: 35.0 },
      { timestamp: baseTimestamp + 45000, priceSol: 0.000125, liquiditySol: 38.0 }, // +25% triggers Take-Profit
      { timestamp: baseTimestamp + 60000, priceSol: 0.000135, liquiditySol: 40.0 },
    ];

    return {
      mint,
      symbol: `sPUMP${index}`,
      name: `[SYNTHETIC] Safe Pump Token ${index}`,
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'STANDARD_PUMP',
      description: 'Legitimate token that appreciates +35%, triggering take-profit exit.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: `[SYNTHETIC] Safe Pump Token ${index}`,
        symbol: `sPUMP${index}`,
        uri: `https://ipfs.io/ipfs/pump${index}`,
        bondingCurve: `CurvePump${index}1111111111111111111111111111111`.slice(0, 44),
        signature: `sig_pump_${index}`,
        slot: 300000010 + index,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 16.0,
        creatorHoldingPercentage: 4.0,
        hasSybilCluster: false,
      }),
      priceHistory,
    };
  }

  /**
   * 9. Missed Opportunity: Token that pumps +80% but was rejected by risk rules
   * (e.g. dev holding is 10.5%, slightly exceeding the 10% strict threshold).
   */
  public static createMissedOpportunityScenario(
    baseTimestamp: number,
    index = 1,
  ): HistoricalTokenScenario {
    const mint = `MissedPump${index}1111111111111111111111111111111`.slice(0, 44);
    const creator = `DevMissed${index}11111111111111111111111111111111`.slice(0, 44);

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 30.0 },
      { timestamp: baseTimestamp + 20000, priceSol: 0.00013, liquiditySol: 38.0 },
      { timestamp: baseTimestamp + 40000, priceSol: 0.00016, liquiditySol: 45.0 },
      { timestamp: baseTimestamp + 60000, priceSol: 0.00018, liquiditySol: 52.0 }, // +80% pump
    ];

    return {
      mint,
      symbol: `mPUMP${index}`,
      name: `[MISSED] Missed Pump Token ${index}`,
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'STANDARD_PUMP',
      description: 'Pumps +80% but dev held 10.5% (> 10% limit), causing safe false-rejection.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: `[MISSED] Missed Pump Token ${index}`,
        symbol: `mPUMP${index}`,
        uri: `https://ipfs.io/ipfs/missed${index}`,
        bondingCurve: `CurveMissed${index}1111111111111111111111111111`.slice(0, 44),
        signature: `sig_missed_${index}`,
        slot: 300000050 + index,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 22.0,
        creatorHoldingPercentage: 10.5, // Exceeds 10.0% limit -> REJECT
        hasSybilCluster: false,
      }),
      priceHistory,
    };
  }

  /**
   * 10. Provider Outage Scenario: Stream fails for 30s during trading.
   */
  public static createProviderOutageScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'Outage1111111111111111111111111111111111111';
    const creator = 'DevOutage111111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 30.0 },
      { timestamp: baseTimestamp + 35000, priceSol: 0.00011, liquiditySol: 32.0 },
    ];

    return {
      mint,
      symbol: 'OUTAGE',
      name: '[STRESS] Provider Outage Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'PROVIDER_OUTAGE',
      description: 'Stream provider experiences 30s outage, triggering system state pause.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Provider Outage Token',
        symbol: 'OUTAGE',
        uri: 'https://ipfs.io/ipfs/outage',
        bondingCurve: 'CurveOutage11111111111111111111111111111',
        signature: 'sig_outage_1',
        slot: 300000080,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 18.0,
        creatorHoldingPercentage: 4.0,
        hasSybilCluster: false,
      }),
      priceHistory,
      adversarialFlags: {
        providerOutageDurationMs: 30000,
      },
    };
  }

  /**
   * 11. Telegram Delivery Failure: Notification drops, trading continues unharmed.
   */
  public static createTelegramFailureScenario(baseTimestamp: number): HistoricalTokenScenario {
    const mint = 'TgFail111111111111111111111111111111111111';
    const creator = 'DevTgFail11111111111111111111111111111111';

    const priceHistory: BacktestPriceQuote[] = [
      { timestamp: baseTimestamp, priceSol: 0.0001, liquiditySol: 30.0 },
      { timestamp: baseTimestamp + 15000, priceSol: 0.000125, liquiditySol: 36.0 }, // +25% TP
    ];

    return {
      mint,
      symbol: 'TGFAIL',
      name: '[STRESS] Telegram Delivery Failure Token',
      creator,
      origin: 'SYNTHETIC_STRESS_TEST',
      groundTruth: 'LEGITIMATE',
      scenarioType: 'TELEGRAM_DELIVERY_FAILURE',
      description: 'Simulates Telegram delivery failures during alerts while execution proceeds.',
      discoveryEvent: {
        type: 'TOKEN_CREATED',
        mint,
        creator,
        name: '[STRESS] Telegram Delivery Failure Token',
        symbol: 'TGFAIL',
        uri: 'https://ipfs.io/ipfs/tgfail',
        bondingCurve: 'CurveTgFail11111111111111111111111111111',
        signature: 'sig_tgfail_1',
        slot: 300000090,
        timestamp: baseTimestamp,
        receivedAt: new Date(baseTimestamp),
        source: 'mock',
        initialSolLiquidity: 30.0,
      },
      analysisReport: buildMockAnalysisReport({
        mint,
        creator,
        timestamp: baseTimestamp,
        initialLiquiditySol: 30.0,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        top10Percentage: 15.0,
        creatorHoldingPercentage: 3.0,
        hasSybilCluster: false,
      }),
      priceHistory,
      adversarialFlags: {
        telegramFailures: true,
      },
    };
  }
}
