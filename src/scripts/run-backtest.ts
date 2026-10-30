#!/usr/bin/env node
import { BacktestEngine } from '../modules/backtest/backtest-engine.js';
import { EvaluationReporter } from '../modules/backtest/evaluation-reporter.js';
import { logger } from '../modules/observability/logger.js';

async function main() {
  console.log('================================================================');
  console.log(' PumpSentinel Quantitative Backtesting & Evaluation Engine');
  console.log('================================================================\n');

  const engine = new BacktestEngine();

  try {
    const report = await engine.run({
      startingBalanceSol: 10.0,
      fixedPositionSizeSol: 0.5,
      solPriceUsd: 160.0,
      inSampleRatio: 0.65,
      strictLookaheadCheck: true,
      generateMarkdownReport: true,
    });

    const cm = report.combinedResults.classificationMetrics;
    const fm = report.combinedResults.financialMetrics;

    console.log('\n--- 1. EVALUATION DATASET OVERVIEW ---');
    console.log(`Total Tokens Evaluated:   ${report.totalTokens}`);
    console.log(`- Historical Measured:   ${report.measuredTokenCount}`);
    console.log(`- Synthetic Stress Suite: ${report.syntheticTokenCount}`);
    console.log(
      `Risk Gate Rejections:     ${report.combinedResults.rejectedCount} (${report.combinedResults.rejectionRatePct}%)`,
    );

    console.log('\n--- 2. RISK CLASSIFICATION & SCAM DETECTION ---');
    console.log(`True Positives (Rugs Blocked):   ${cm.truePositives}`);
    console.log(`False Negatives (Rugs Allowed):  ${cm.falseNegatives}`);
    console.log(`True Negatives (Clean Traded):   ${cm.trueNegatives}`);
    console.log(`False Positives (Conservative):  ${cm.falsePositives}`);
    console.log(`Scam Catch Recall Rate:          ${cm.recallPct}%`);
    console.log(`Classification Precision:        ${cm.precisionPct}%`);
    console.log(`F1-Score:                        ${cm.f1Score}`);

    console.log('\n--- 3. FINANCIAL TRADING PERFORMANCE ---');
    if (fm.smallSampleWarning) {
      console.log(`⚠️  ${fm.smallSampleWarning}`);
    }
    console.log(`Simulated Trades Executed:       ${fm.totalTrades}`);
    console.log(
      `Win Rate:                        ${fm.winRatePct}% (95% CI: [${fm.winRateConfidenceInterval95[0]}%, ${fm.winRateConfidenceInterval95[1]}%])`,
    );
    console.log(
      `Net P&L (SOL):                   ${fm.netPnlSol >= 0 ? '+' : ''}${fm.netPnlSol.toFixed(4)} SOL`,
    );
    console.log(
      `Net P&L (USD):                   $${fm.netPnlUsd >= 0 ? '+' : ''}${fm.netPnlUsd.toFixed(2)}`,
    );
    console.log(
      `Max Portfolio Drawdown:          ${fm.maxDrawdownPct}% (${fm.maxDrawdownSol.toFixed(4)} SOL)`,
    );
    console.log(`Profit Factor:                   ${fm.profitFactor}`);
    console.log(
      `Avg Holding Duration:            ${Math.round(fm.averageHoldingDurationMs / 1000)}s`,
    );

    console.log('\n--- 4. BASELINE BENCHMARK COMPARISON ---');
    for (const b of report.baselines) {
      const net = `${b.netPnlSol >= 0 ? '+' : ''}${b.netPnlSol.toFixed(4)} SOL`;
      console.log(
        `* ${b.strategy.padEnd(16)} | Trades: ${String(b.tradeCount).padStart(2)} | WinRate: ${String(b.winRatePct).padStart(5)}% | Net: ${net.padStart(11)} | Scams Entered: ${b.scamsEnteredCount}`,
      );
    }

    // Save report to file
    const reportPath = await EvaluationReporter.saveReportToFile(report);
    console.log(`\n================================================================`);
    console.log(` Full Markdown Report Saved To:`);
    console.log(` ${reportPath}`);
    console.log(`================================================================\n`);

    process.exit(0);
  } catch (error) {
    logger.error({ error }, '[run-backtest] Backtest failed with unhandled error');
    console.error('Fatal Backtest Failure:', error);
    process.exit(1);
  }
}

main();
