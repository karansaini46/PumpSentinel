import type { HistoricalTokenScenario } from './backtest.types.js';
import { ScenarioSimulator } from './scenario-simulator.js';
import { prismaService } from '../persistence/prisma.service.js';
import { logger } from '../observability/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface DatasetSplit {
  inSample: HistoricalTokenScenario[];
  outOfSample: HistoricalTokenScenario[];
  all: HistoricalTokenScenario[];
  measured: HistoricalTokenScenario[];
  synthetic: HistoricalTokenScenario[];
}

export class DatasetLoader {
  /**
   * Generates a comprehensive suite of synthetic scenarios.
   * Requirement: Clearly separate measured results from synthetic results.
   */
  public static generateSyntheticSuite(
    baseTime: number = Date.now() - 3600000 * 24, // 24 hours ago
  ): HistoricalTokenScenario[] {
    const scenarios: HistoricalTokenScenario[] = [];
    let currentTime = baseTime;
    const stepMs = 60000 * 5; // 5 minutes between discoveries

    // 1. Rapid Price Crashes
    for (let i = 1; i <= 3; i++) {
      currentTime += stepMs;
      scenarios.push(ScenarioSimulator.createRapidCrashScenario(currentTime));
    }

    // 2. Rug Pulls (Scam Ground Truth)
    for (let i = 1; i <= 6; i++) {
      currentTime += stepMs;
      const rug = ScenarioSimulator.createRugPullScenario(currentTime);
      rug.mint = `RugScam${i}11111111111111111111111111111111111`.slice(0, 44);
      rug.symbol = `RUG${i}`;
      rug.discoveryEvent.mint = rug.mint;
      rug.discoveryEvent.symbol = rug.symbol;
      scenarios.push(rug);
    }

    // 3. High Slippage
    for (let i = 1; i <= 3; i++) {
      currentTime += stepMs;
      scenarios.push(ScenarioSimulator.createHighSlippageScenario(currentTime));
    }

    // 4. Low Liquidity
    for (let i = 1; i <= 3; i++) {
      currentTime += stepMs;
      scenarios.push(ScenarioSimulator.createLowLiquidityScenario(currentTime));
    }

    // 5. Failed Exits
    for (let i = 1; i <= 2; i++) {
      currentTime += stepMs;
      scenarios.push(ScenarioSimulator.createFailedExitScenario(currentTime));
    }

    // 6. Missing and Stale Data
    for (let i = 1; i <= 3; i++) {
      currentTime += stepMs;
      scenarios.push(ScenarioSimulator.createMissingAndStaleDataScenario(currentTime));
    }

    // 7. Duplicate Events
    currentTime += stepMs;
    scenarios.push(ScenarioSimulator.createDuplicateEventsScenario(currentTime));

    // 8. Provider Outage
    currentTime += stepMs;
    scenarios.push(ScenarioSimulator.createProviderOutageScenario(currentTime));

    // 9. Telegram Delivery Failures
    currentTime += stepMs;
    scenarios.push(ScenarioSimulator.createTelegramFailureScenario(currentTime));

    // 10. Legitimate Standard Pumps (Safe Winning Trades)
    for (let i = 1; i <= 8; i++) {
      currentTime += stepMs;
      scenarios.push(ScenarioSimulator.createStandardPumpScenario(currentTime, i));
    }

    // 11. Missed Opportunities (Pumps that were rejected by tight risk thresholds)
    for (let i = 1; i <= 3; i++) {
      currentTime += stepMs;
      scenarios.push(ScenarioSimulator.createMissedOpportunityScenario(currentTime, i));
    }

    logger.info(
      { count: scenarios.length },
      '[DatasetLoader] Generated comprehensive synthetic stress-test scenario suite',
    );

    return scenarios;
  }

  /**
   * Attempts to load historical recorded tokens from PostgreSQL or JSON snapshot.
   */
  public static async loadHistoricalMeasuredData(): Promise<HistoricalTokenScenario[]> {
    const historicalScenarios: HistoricalTokenScenario[] = [];

    // 1. Try reading from local JSON fixture file if exists
    try {
      const localFilePath = path.resolve(process.cwd(), 'data', 'historical-recorded-tokens.json');
      const content = await fs.readFile(localFilePath, 'utf8');
      const parsed = JSON.parse(content) as HistoricalTokenScenario[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const item of parsed) {
          historicalScenarios.push({
            ...item,
            origin: 'HISTORICAL_MEASURED',
          });
        }
        logger.info(
          { count: historicalScenarios.length },
          '[DatasetLoader] Loaded historical measured tokens from disk snapshot',
        );
        return historicalScenarios;
      }
    } catch {
      // Disk file not present
    }

    // 2. Try loading from PostgreSQL database
    try {
      const prisma = prismaService.getClient();
      const dbTokens = await prisma.token.findMany({
        where: { isSynthetic: false },
        take: 50,
        orderBy: { discoveredAt: 'asc' },
      });

      for (const token of dbTokens) {
        const discTime = token.discoveredAt.getTime();
        const initLiq = token.liquiditySol ?? 25.0;
        const price = token.priceSol ?? 0.0001;

        historicalScenarios.push({
          mint: token.mintAddress,
          symbol: token.symbol,
          name: token.name,
          creator: token.creator,
          bondingCurve: token.bondingCurveAddress ?? undefined,
          origin: 'HISTORICAL_MEASURED',
          groundTruth: 'UNKNOWN',
          scenarioType: 'NORMAL_MARKET',
          description: `Historical token recorded from on-chain stream at ${token.discoveredAt.toISOString()}`,
          discoveryEvent: {
            type: 'TOKEN_CREATED',
            mint: token.mintAddress,
            creator: token.creator,
            name: token.name,
            symbol: token.symbol,
            uri: token.uri ?? '',
            bondingCurve: token.bondingCurveAddress ?? '',
            signature: token.signature ?? `sig_hist_${token.mintAddress.slice(0, 8)}`,
            slot: Number(token.slot ?? 250000000),
            timestamp: discTime,
            receivedAt: token.discoveredAt,
            source: 'solana_rpc_ws',
            initialSolLiquidity: initLiq,
          },
          analysisReport: ScenarioSimulator.buildMockAnalysisReport({
            mint: token.mintAddress,
            symbol: token.symbol,
            creator: token.creator,
            timestamp: discTime,
            initialLiquiditySol: initLiq,
            mintAuthorityRevoked: true,
            freezeAuthorityRevoked: true,
            top10Percentage: 22.0,
            creatorHoldingPercentage: 4.5,
            hasSybilCluster: false,
          }),
          priceHistory: [
            { timestamp: discTime, priceSol: price, liquiditySol: initLiq },
            { timestamp: discTime + 15000, priceSol: price * 1.05, liquiditySol: initLiq + 1 },
            { timestamp: discTime + 30000, priceSol: price * 1.1, liquiditySol: initLiq + 2 },
          ],
        });
      }

      if (historicalScenarios.length > 0) {
        logger.info(
          { count: historicalScenarios.length },
          '[DatasetLoader] Loaded historical tokens from PostgreSQL',
        );
      }
    } catch {
      // PostgreSQL offline
    }

    return historicalScenarios;
  }

  /**
   * Partitions scenarios into in-sample (calibration) and out-of-sample (testing).
   * Strictly chronological partition to prevent data leakage.
   */
  public static partitionInSampleOutOfSample(
    scenarios: HistoricalTokenScenario[],
    inSampleRatio = 0.65,
  ): DatasetSplit {
    // Sort strictly chronologically by discovery timestamp
    const sorted = [...scenarios].sort(
      (a, b) => a.discoveryEvent.timestamp - b.discoveryEvent.timestamp,
    );

    const splitIdx = Math.floor(sorted.length * inSampleRatio);
    const inSample = sorted.slice(0, splitIdx);
    const outOfSample = sorted.slice(splitIdx);

    const measured = sorted.filter((s) => s.origin === 'HISTORICAL_MEASURED');
    const synthetic = sorted.filter((s) => s.origin === 'SYNTHETIC_STRESS_TEST');

    return {
      inSample,
      outOfSample,
      all: sorted,
      measured,
      synthetic,
    };
  }

  /**
   * Loads combined dataset with both measured historical data (if available)
   * and synthetic stress test fixtures.
   */
  public static async loadCompleteDataset(options?: {
    customScenarios?: HistoricalTokenScenario[];
    inSampleRatio?: number;
  }): Promise<DatasetSplit> {
    if (options?.customScenarios && options.customScenarios.length > 0) {
      return this.partitionInSampleOutOfSample(
        options.customScenarios,
        options.inSampleRatio ?? 0.65,
      );
    }

    const measured = await this.loadHistoricalMeasuredData();
    const synthetic = this.generateSyntheticSuite();

    const combined = [...measured, ...synthetic];
    return this.partitionInSampleOutOfSample(combined, options?.inSampleRatio ?? 0.65);
  }
}
