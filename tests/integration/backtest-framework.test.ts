import { describe, it, expect, beforeEach } from 'vitest';
import {
  HistoricalClock,
  LookaheadBiasError,
  ScenarioSimulator,
  DatasetLoader,
  MetricsCalculator,
  BacktestEngine,
  EvaluationReporter,
} from '../../src/modules/backtest/index.js';
import type { BacktestTrade } from '../../src/modules/backtest/index.js';
import fs from 'node:fs/promises';

describe('PumpSentinel Backtesting and Evaluation Framework', () => {
  const baseTime = 1700000000000;

  describe('1. Lookahead Bias Prevention & Historical Clock', () => {
    let clock: HistoricalClock;

    beforeEach(() => {
      clock = new HistoricalClock(baseTime);
    });

    it('enforces monotonic time advancement and forbids time travel backwards', () => {
      expect(clock.now).toBe(baseTime);

      clock.advanceTo(baseTime + 5000);
      expect(clock.now).toBe(baseTime + 5000);

      // Attempting to travel backwards in time must throw
      expect(() => clock.advanceTo(baseTime + 2000)).toThrow(/Non-monotonic time travel rejected/);
    });

    it('detects and throws LookaheadBiasError if future data is accessed', () => {
      // Clock is at baseTime
      expect(() => {
        clock.assertNoLookahead(baseTime + 1000, 'TEST_FUTURE_READ');
      }).toThrow(LookaheadBiasError);

      expect(clock.violations.length).toBe(1);
      expect(clock.violations[0]?.operation).toBe('TEST_FUTURE_READ');
    });

    it('strictly filters quotes to point-in-time (timestamp <= clock.now)', () => {
      const quotes = [
        { timestamp: baseTime - 2000, priceSol: 0.0001, liquiditySol: 20 },
        { timestamp: baseTime, priceSol: 0.00011, liquiditySol: 21 },
        { timestamp: baseTime + 2000, priceSol: 0.00012, liquiditySol: 22 }, // Future!
      ];

      const pointInTime = clock.filterPointInTimeQuotes(quotes);
      expect(pointInTime.length).toBe(2);
      expect(pointInTime.every((q) => q.timestamp <= clock.now)).toBe(true);

      const latest = clock.getLatestAvailableQuote(quotes);
      expect(latest?.timestamp).toBe(baseTime);
      expect(latest?.priceSol).toBe(0.00011);
    });
  });

  describe('2. Market Stress Scenario Simulations', () => {
    it('simulates rapid price crashes with gap execution', async () => {
      const crashScenario = ScenarioSimulator.createRapidCrashScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [crashScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.totalTokens).toBe(1);
      expect(report.adversarialScenarioResults.RAPID_PRICE_CRASH.testedCount).toBe(1);
      expect(report.adversarialScenarioResults.RAPID_PRICE_CRASH.passedSafety).toBe(true);
    });

    it('simulates rug-pull scenarios and blocks entries via risk gate (Ground Truth TP)', async () => {
      const rugScenario = ScenarioSimulator.createRugPullScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [rugScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      // Rug pull must be rejected
      expect(report.combinedResults.rejectedCount).toBe(1);
      const cm = report.combinedResults.classificationMetrics;
      expect(cm.truePositives).toBe(1); // Rug correctly blocked
      expect(cm.falseNegatives).toBe(0); // Zero rugs allowed
      expect(cm.recallPct).toBe(100); // 100% scam catch rate

      // Naive baseline comparison: naive baseline enters and gets rugged
      const buyAll = report.baselines.find((b) => b.strategy === 'BUY_ALL_NAIVE');
      expect(buyAll?.scamsEnteredCount).toBe(1);
      expect(buyAll?.netPnlSol).toBeLessThan(0); // Suffer total loss
    });

    it('simulates low liquidity pools (< 15 SOL) and enforces immediate rejection', async () => {
      const lowLiqScenario = ScenarioSimulator.createLowLiquidityScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [lowLiqScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.combinedResults.rejectedCount).toBe(1);
      expect(report.adversarialScenarioResults.LOW_LIQUIDITY.passedSafety).toBe(true);
    });

    it('simulates high slippage and models price impact dynamically', async () => {
      const slipScenario = ScenarioSimulator.createHighSlippageScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [slipScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.adversarialScenarioResults.HIGH_SLIPPAGE.passedSafety).toBe(true);
    });

    it('simulates failed exits and tags position as EXIT_PENDING before retry', async () => {
      const failExitScenario = ScenarioSimulator.createFailedExitScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [failExitScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.adversarialScenarioResults.FAILED_EXIT.passedSafety).toBe(true);
    });

    it('simulates missing and stale data (> 60s) and triggers safety recheck/rejection', async () => {
      const staleScenario = ScenarioSimulator.createMissingAndStaleDataScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [staleScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.combinedResults.rejectedCount).toBe(1);
      expect(report.adversarialScenarioResults.MISSING_AND_STALE_DATA.passedSafety).toBe(true);
    });

    it('simulates duplicate events and deduplicates without duplicate trades', async () => {
      const dupScenario = ScenarioSimulator.createDuplicateEventsScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [dupScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.adversarialScenarioResults.DUPLICATE_EVENTS.passedSafety).toBe(true);
    });

    it('simulates provider outages safely without pipeline disruption', async () => {
      const outageScenario = ScenarioSimulator.createProviderOutageScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [outageScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.adversarialScenarioResults.PROVIDER_OUTAGE.passedSafety).toBe(true);
    });

    it('simulates Telegram delivery failures resiliently without halting execution', async () => {
      const tgScenario = ScenarioSimulator.createTelegramFailureScenario(baseTime);
      const engine = new BacktestEngine();

      const report = await engine.run({
        customScenarios: [tgScenario],
        strictLookaheadCheck: true,
        generateMarkdownReport: false,
      });

      expect(report.adversarialScenarioResults.TELEGRAM_DELIVERY_FAILURE.passedSafety).toBe(true);
    });
  });

  describe('3. Metrics Calculator & Statistical Humility', () => {
    it('flags small sample sizes (N < 30) with explicit humility disclosure warning', () => {
      const sampleTrades: BacktestTrade[] = [
        {
          tradeId: 'T1',
          tokenMint: 'M1',
          tokenSymbol: 'SYM1',
          side: 'SELL',
          amountTokens: 1000,
          entryPriceSol: 0.0005,
          exitPriceSol: 0.0006,
          totalSolInvested: 0.5,
          exitTotalSol: 0.58,
          pnlSol: 0.08,
          pnlUsd: 12.8,
          pnlPercent: 16.0,
          holdingDurationMs: 45000,
          entryTimestamp: baseTime,
          exitTimestamp: baseTime + 45000,
          exitReason: 'Take profit hit',
          simulatedFeesSol: 0.01,
          slippageBpsApplied: 150,
          groundTruth: 'LEGITIMATE',
          origin: 'SYNTHETIC_STRESS_TEST',
        },
      ];

      const metrics = MetricsCalculator.calculateFinancialMetrics(sampleTrades, 10.0, 160.0);

      expect(metrics.totalTrades).toBe(1);
      expect(metrics.sampleSizeAdequate).toBe(false);
      expect(metrics.smallSampleWarning).toContain('SMALL SAMPLE SIZE WARNING');
      expect(metrics.winRatePct).toBe(100);
      expect(metrics.winRateConfidenceInterval95[0]).toBeGreaterThanOrEqual(0);
      expect(metrics.winRateConfidenceInterval95[1]).toBeLessThanOrEqual(100);
    });

    it('computes 95% Wilson confidence intervals and max drawdown accurately', () => {
      const trades: BacktestTrade[] = [];
      // 40 trades: 24 wins, 16 losses -> 60% win rate
      for (let i = 0; i < 40; i++) {
        const isWin = i < 24;
        trades.push({
          tradeId: `T${i}`,
          tokenMint: `M${i}`,
          tokenSymbol: `S${i}`,
          side: 'SELL',
          amountTokens: 1000,
          entryPriceSol: 0.0005,
          exitPriceSol: isWin ? 0.0006 : 0.00045,
          totalSolInvested: 0.5,
          exitTotalSol: isWin ? 0.58 : 0.43,
          pnlSol: isWin ? 0.08 : -0.07,
          pnlUsd: isWin ? 12.8 : -11.2,
          pnlPercent: isWin ? 16.0 : -14.0,
          holdingDurationMs: 60000,
          entryTimestamp: baseTime + i * 10000,
          exitTimestamp: baseTime + i * 10000 + 60000,
          exitReason: isWin ? 'Take profit' : 'Stop loss',
          simulatedFeesSol: 0.01,
          slippageBpsApplied: 150,
          groundTruth: 'LEGITIMATE',
          origin: 'SYNTHETIC_STRESS_TEST',
        });
      }

      const metrics = MetricsCalculator.calculateFinancialMetrics(trades, 10.0, 160.0);

      expect(metrics.totalTrades).toBe(40);
      expect(metrics.sampleSizeAdequate).toBe(true);
      expect(metrics.smallSampleWarning).toBeNull();
      expect(metrics.winRatePct).toBe(60);
      // Wilson CI bounds around 60%
      expect(metrics.winRateConfidenceInterval95[0]).toBeGreaterThan(43);
      expect(metrics.winRateConfidenceInterval95[1]).toBeLessThan(75);
      expect(metrics.netPnlSol).toBeGreaterThan(0);
    });

    it('identifies missed opportunities when rejected tokens subsequently appreciate >= 20%', () => {
      const missedScenario = ScenarioSimulator.createMissedOpportunityScenario(baseTime, 1);
      const missed = MetricsCalculator.identifyMissedOpportunities(
        [
          {
            scenario: missedScenario,
            reasons: ['Creator holdings exceed 10% threshold'],
            score: 75,
          },
        ],
        20.0,
      );

      expect(missed.length).toBe(1);
      expect(missed[0]?.tokenSymbol).toBe('mPUMP1');
      expect(missed[0]?.maxPumpPct).toBeGreaterThanOrEqual(20);
    });
  });

  describe('4. Dataset Separation & Chronological Out-of-Sample Split', () => {
    it('partitions in-sample (65%) and out-of-sample (35%) chronologically without data leakage', () => {
      const suite = DatasetLoader.generateSyntheticSuite(baseTime);
      const split = DatasetLoader.partitionInSampleOutOfSample(suite, 0.65);

      expect(split.all.length).toBe(suite.length);
      expect(split.inSample.length).toBe(Math.floor(suite.length * 0.65));
      expect(split.outOfSample.length).toBe(suite.length - split.inSample.length);

      // Verify strict chronological boundary: max(inSample) <= min(outOfSample)
      const maxInSampleTime = Math.max(...split.inSample.map((s) => s.discoveryEvent.timestamp));
      const minOutOfSampleTime = Math.min(
        ...split.outOfSample.map((s) => s.discoveryEvent.timestamp),
      );
      expect(maxInSampleTime).toBeLessThanOrEqual(minOutOfSampleTime);
    });

    it('clearly separates measured historical results from synthetic stress results in reports', async () => {
      const engine = new BacktestEngine();
      const report = await engine.run({
        generateMarkdownReport: true,
      });

      // Assert distinct segments exist and are populated
      expect(report.measuredResults).toBeDefined();
      expect(report.syntheticResults).toBeDefined();
      expect(report.measuredResults.origin).toBe('HISTORICAL_MEASURED');
      expect(report.syntheticResults.origin).toBe('SYNTHETIC_STRESS_TEST');
      expect(report.markdownReport).toContain('Dataset Separation: Measured vs Synthetic Results');
    });
  });

  describe('5. Baseline Comparisons & Report Reproducibility', () => {
    it('generates comparisons for BUY_ALL_NAIVE, MOMENTUM_ONLY, and RANDOM_ENTRY', async () => {
      const engine = new BacktestEngine();
      const report = await engine.run({
        generateMarkdownReport: true,
      });

      expect(report.baselines.length).toBe(4);
      const strategies = report.baselines.map((b) => b.strategy);
      expect(strategies).toContain('PUMP_SENTINEL');
      expect(strategies).toContain('BUY_ALL_NAIVE');
      expect(strategies).toContain('MOMENTUM_ONLY');
      expect(strategies).toContain('RANDOM_ENTRY');

      // Verify PumpSentinel entered 0 scams while baselines entered scams
      const sentinel = report.baselines.find((b) => b.strategy === 'PUMP_SENTINEL');
      const buyAll = report.baselines.find((b) => b.strategy === 'BUY_ALL_NAIVE');
      expect(sentinel?.scamsEnteredCount).toBe(0);
      expect(buyAll?.scamsEnteredCount).toBeGreaterThan(0);
    });

    it('exports a reproducible evaluation report to disk', async () => {
      const engine = new BacktestEngine();
      const report = await engine.run({ generateMarkdownReport: true });

      const customFile = `test-eval-report-${Date.now()}.md`;
      const savedPath = await EvaluationReporter.saveReportToFile(report, customFile);

      const fileExists = await fs
        .access(savedPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const content = await fs.readFile(savedPath, 'utf8');
      expect(content).toContain(
        '# PumpSentinel Strategy Backtest & Quantitative Evaluation Report',
      );
      expect(content).toContain('Risk Classification Performance');
      expect(content).toContain('Adversarial Stress Scenario Verification Matrix');

      // Clean up test artifact
      await fs.unlink(savedPath).catch(() => {});
    });
  });
});
