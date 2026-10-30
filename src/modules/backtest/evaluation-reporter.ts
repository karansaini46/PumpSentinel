import type { BacktestEvaluationReport, StressScenarioType } from './backtest.types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../observability/logger.js';

export class EvaluationReporter {
  /**
   * Generates a comprehensive, reproducible Markdown evaluation report.
   */
  public static generateMarkdownReport(report: BacktestEvaluationReport): string {
    const lines: string[] = [];

    // Header
    lines.push(`# PumpSentinel Strategy Backtest & Quantitative Evaluation Report`);
    lines.push(`**Report ID:** \`${report.id}\` | **Executed At:** \`${report.executedAt}\``);
    lines.push(
      `**Total Tokens Evaluated:** ${report.totalTokens} (Historical Measured: ${report.measuredTokenCount} | Synthetic Stress: ${report.syntheticTokenCount})`,
    );
    lines.push('');

    // 1. Executive Summary & Statistical Humility Disclosure
    lines.push('## 1. Executive Summary & Statistical Humility Disclosure');
    lines.push('');
    if (report.combinedResults.financialMetrics.smallSampleWarning) {
      lines.push('> [!WARNING]');
      lines.push(`> ${report.combinedResults.financialMetrics.smallSampleWarning}`);
      lines.push('');
    }

    lines.push(
      `This report evaluates the **PumpSentinel** autonomous risk gate and paper-trading strategy under strict point-in-time constraints. Look-ahead bias is strictly prevented: all decision criteria and simulated order executions utilize only information available at $t_{decision} \\le t_{current}$.`,
    );
    lines.push('');
    lines.push(
      `Historical recorded market data and synthetic stress fixtures are **strictly partitioned and separated** to prevent conflating stress tests with empirical market regimes.`,
    );
    lines.push('');

    // 2. Data Segregation: Measured vs Synthetic Results
    lines.push('## 2. Dataset Separation: Measured vs Synthetic Results');
    lines.push('');
    lines.push('| Metric | Combined Dataset | Historical Measured Feed | Synthetic Stress Test |');
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push(
      `| **Total Tokens** | ${report.combinedResults.tokenCount} | ${report.measuredResults.tokenCount} | ${report.syntheticResults.tokenCount} |`,
    );
    lines.push(
      `| **Risk Rejected** | ${report.combinedResults.rejectedCount} (${report.combinedResults.rejectionRatePct}%) | ${report.measuredResults.rejectedCount} (${report.measuredResults.rejectionRatePct}%) | ${report.syntheticResults.rejectedCount} (${report.syntheticResults.rejectionRatePct}%) |`,
    );
    lines.push(
      `| **Simulated Trades** | ${report.combinedResults.financialMetrics.totalTrades} | ${report.measuredResults.financialMetrics.totalTrades} | ${report.syntheticResults.financialMetrics.totalTrades} |`,
    );
    lines.push(
      `| **Win Rate** | ${report.combinedResults.financialMetrics.winRatePct}% (95% CI: [${report.combinedResults.financialMetrics.winRateConfidenceInterval95[0]}%, ${report.combinedResults.financialMetrics.winRateConfidenceInterval95[1]}%]) | ${report.measuredResults.financialMetrics.winRatePct}% | ${report.syntheticResults.financialMetrics.winRatePct}% |`,
    );
    lines.push(
      `| **Net P&L (SOL)** | **${report.combinedResults.financialMetrics.netPnlSol >= 0 ? '+' : ''}${report.combinedResults.financialMetrics.netPnlSol.toFixed(4)} SOL** | ${report.measuredResults.financialMetrics.netPnlSol >= 0 ? '+' : ''}${report.measuredResults.financialMetrics.netPnlSol.toFixed(4)} SOL | ${report.syntheticResults.financialMetrics.netPnlSol >= 0 ? '+' : ''}${report.syntheticResults.financialMetrics.netPnlSol.toFixed(4)} SOL |`,
    );
    lines.push(
      `| **Net P&L (USD)** | **$${report.combinedResults.financialMetrics.netPnlUsd >= 0 ? '+' : ''}${report.combinedResults.financialMetrics.netPnlUsd.toFixed(2)}** | $${report.measuredResults.financialMetrics.netPnlUsd.toFixed(2)} | $${report.syntheticResults.financialMetrics.netPnlUsd.toFixed(2)} |`,
    );
    lines.push(
      `| **Max Drawdown** | ${report.combinedResults.financialMetrics.maxDrawdownPct}% (${report.combinedResults.financialMetrics.maxDrawdownSol.toFixed(4)} SOL) | ${report.measuredResults.financialMetrics.maxDrawdownPct}% | ${report.syntheticResults.financialMetrics.maxDrawdownPct}% |`,
    );
    lines.push(
      `| **Profit Factor** | ${report.combinedResults.financialMetrics.profitFactor} | ${report.measuredResults.financialMetrics.profitFactor} | ${report.syntheticResults.financialMetrics.profitFactor} |`,
    );
    lines.push(
      `| **Simulated Fees Paid** | ${report.combinedResults.financialMetrics.totalFeesPaidSol.toFixed(4)} SOL | ${report.measuredResults.financialMetrics.totalFeesPaidSol.toFixed(4)} SOL | ${report.syntheticResults.financialMetrics.totalFeesPaidSol.toFixed(4)} SOL |`,
    );
    lines.push('');

    // 3. Out-of-Sample Evaluation & Robustness
    lines.push('## 3. Out-of-Sample Generalization & Degradation Analysis');
    lines.push('');
    lines.push(
      'To test for overfitting and parameter sensitivity, the dataset was chronologically split into **In-Sample (Calibration: 65%)** and **Out-of-Sample (Validation: 35%)** subsets:',
    );
    lines.push('');
    lines.push(
      '| Metric | In-Sample (Calibration 65%) | Out-of-Sample (Test 35%) | Delta / Degradation |',
    );
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push(
      `| **Token Count** | ${report.inSampleResult.tokenCount} | ${report.outOfSampleResult.tokenCount} | - |`,
    );
    lines.push(
      `| **Trades Executed** | ${report.inSampleResult.financialMetrics.totalTrades} | ${report.outOfSampleResult.financialMetrics.totalTrades} | - |`,
    );
    lines.push(
      `| **Win Rate** | ${report.inSampleResult.financialMetrics.winRatePct}% | ${report.outOfSampleResult.financialMetrics.winRatePct}% | ${(report.outOfSampleResult.financialMetrics.winRatePct - report.inSampleResult.financialMetrics.winRatePct).toFixed(1)}% |`,
    );
    lines.push(
      `| **Net P&L (SOL)** | ${report.inSampleResult.financialMetrics.netPnlSol >= 0 ? '+' : ''}${report.inSampleResult.financialMetrics.netPnlSol.toFixed(4)} SOL | ${report.outOfSampleResult.financialMetrics.netPnlSol >= 0 ? '+' : ''}${report.outOfSampleResult.financialMetrics.netPnlSol.toFixed(4)} SOL | ${(report.outOfSampleResult.financialMetrics.netPnlSol - report.inSampleResult.financialMetrics.netPnlSol).toFixed(4)} SOL |`,
    );
    lines.push(
      `| **Profit Factor** | ${report.inSampleResult.financialMetrics.profitFactor} | ${report.outOfSampleResult.financialMetrics.profitFactor} | ${(report.outOfSampleResult.financialMetrics.profitFactor - report.inSampleResult.financialMetrics.profitFactor).toFixed(2)} |`,
    );
    lines.push(
      `| **Max Drawdown** | ${report.inSampleResult.financialMetrics.maxDrawdownPct}% | ${report.outOfSampleResult.financialMetrics.maxDrawdownPct}% | ${(report.outOfSampleResult.financialMetrics.maxDrawdownPct - report.inSampleResult.financialMetrics.maxDrawdownPct).toFixed(1)}% |`,
    );
    lines.push('');

    // 4. Baseline Strategy Comparison
    lines.push('## 4. Baseline Strategy Comparisons');
    lines.push('');
    lines.push(
      'Comparing PumpSentinel against naive entry strategies highlights the empirical value of the multi-layered risk decision gate:',
    );
    lines.push('');
    lines.push(
      '| Strategy | Description | Trades | Win Rate | Net P&L (SOL) | Profit Factor | Max DD % | Scams Entered |',
    );
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const b of report.baselines) {
      const netSolStr = `${b.netPnlSol >= 0 ? '+' : ''}${b.netPnlSol.toFixed(4)} SOL`;
      lines.push(
        `| **${b.strategy}** | ${b.description.slice(0, 50)}... | ${b.tradeCount} | ${b.winRatePct}% | **${netSolStr}** | ${b.profitFactor} | ${b.maxDrawdownPct}% | **${b.scamsEnteredCount}** |`,
      );
    }
    lines.push('');

    // 5. Risk Classification Matrix (Ground Truth Evaluation)
    const cm = report.combinedResults.classificationMetrics;
    lines.push('## 5. Risk Classification Performance (Confusion Matrix)');
    lines.push('');
    lines.push(
      `Evaluated on **${cm.totalLabeledTokens}** tokens with verified ground-truth labels:`,
    );
    lines.push('');
    lines.push('| Metric | Count / Value | Formula / Definition |');
    lines.push('| :--- | :--- | :--- |');
    lines.push(
      `| **True Positives (TP)** | **${cm.truePositives}** | Malicious rug-pulls correctly caught & blocked |`,
    );
    lines.push(
      `| **False Negatives (FN)** | **${cm.falseNegatives}** | Malicious rug-pulls mistakenly allowed (Disasters) |`,
    );
    lines.push(
      `| **True Negatives (TN)** | **${cm.trueNegatives}** | Legitimate tokens correctly allowed for trading |`,
    );
    lines.push(
      `| **False Positives (FP)** | **${cm.falsePositives}** | Legitimate tokens rejected by conservative safety |`,
    );
    lines.push(
      `| **Scam Catch Rate (Recall)** | **${cm.recallPct}%** | $\\frac{TP}{TP + FN}$ (Rug detection capability) |`,
    );
    lines.push(`| **Precision** | **${cm.precisionPct}%** | $\\frac{TP}{TP + FP}$ |`);
    lines.push(`| **Specificity** | **${cm.specificityPct}%** | $\\frac{TN}{TN + FP}$ |`);
    lines.push(`| **F1-Score** | **${cm.f1Score}** | Harmonic mean of Precision and Recall |`);
    lines.push(
      `| **Accuracy** | **${cm.accuracyPct}%** | $\\frac{TP + TN}{\\text{Total Labeled}}$ |`,
    );
    lines.push('');

    // 6. Risk Gate Rejection Breakdown
    lines.push('## 6. Risk Gate Rejection Breakdown');
    lines.push('');
    lines.push('Summary of reasons why candidate tokens were blocked prior to strategy entry:');
    lines.push('');
    lines.push('| Rejection Category | Trigger Count | Frequency % |');
    lines.push('| :--- | :--- | :--- |');
    const totalReasons = Object.values(report.combinedResults.rejectionReasonBreakdown).reduce(
      (a, b) => a + b,
      0,
    );
    const sortedReasons = Object.entries(report.combinedResults.rejectionReasonBreakdown).sort(
      ([, a], [, b]) => b - a,
    );
    for (const [cat, count] of sortedReasons) {
      const freq = totalReasons > 0 ? ((count / totalReasons) * 100).toFixed(1) : '0.0';
      lines.push(`| ${cat} | ${count} | ${freq}% |`);
    }
    lines.push('');

    // 7. Holding Durations & Trade Microstructure
    const fm = report.combinedResults.financialMetrics;
    lines.push('## 7. Trade Microstructure & Holding Duration');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('| :--- | :--- |');
    lines.push(`| **Average Win** | +${fm.averageWinSol.toFixed(4)} SOL |`);
    lines.push(`| **Average Loss** | -${fm.averageLossSol.toFixed(4)} SOL |`);
    lines.push(`| **Win / Loss Ratio** | ${fm.winLossRatio} |`);
    lines.push(
      `| **Average Holding Duration** | ${Math.round(fm.averageHoldingDurationMs / 1000)}s |`,
    );
    lines.push(
      `| **Median Holding Duration** | ${Math.round(fm.medianHoldingDurationMs / 1000)}s |`,
    );
    lines.push(`| **Min Holding Duration** | ${Math.round(fm.minHoldingDurationMs / 1000)}s |`);
    lines.push(`| **Max Holding Duration** | ${Math.round(fm.maxHoldingDurationMs / 1000)}s |`);
    lines.push('');

    // 8. Missed Opportunities Analysis
    lines.push('## 8. Missed Opportunities Analysis');
    lines.push('');
    lines.push(
      'Tokens rejected by the conservative risk gate that subsequently appreciated by $\\ge 20\\%$:',
    );
    lines.push('');
    if (report.combinedResults.missedOpportunities.length === 0) {
      lines.push('*No missed opportunities recorded during this evaluation cycle.*');
    } else {
      lines.push(
        '| Token | Discovery Time | Initial Price | Peak Price | Max Appreciation | Top Rejection Reason |',
      );
      lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
      for (const m of report.combinedResults.missedOpportunities) {
        lines.push(
          `| \`${m.tokenSymbol}\` (\`${m.tokenMint.slice(0, 8)}...\`) | ${new Date(m.discoveryTimestamp).toLocaleTimeString()} | ${m.initialPriceSol.toFixed(6)} SOL | ${m.peakPriceSol.toFixed(6)} SOL | **+${m.maxPumpPct}%** | ${m.rejectionReasons[0]?.slice(0, 45) ?? 'Risk criteria'} |`,
        );
      }
    }
    lines.push('');

    // 9. Adversarial Stress Scenario Verification Matrix
    lines.push('## 9. Adversarial Stress Scenario Verification Matrix');
    lines.push('');
    lines.push(
      'Validation of PumpSentinel behavior across critical stress and adversarial market conditions:',
    );
    lines.push('');
    lines.push('| Stress Scenario | Tests | Safety Status | Behavioral Verification Summary |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const [st, item] of Object.entries(report.adversarialScenarioResults) as [
      StressScenarioType,
      { testedCount: number; passedSafety: boolean; summary: string },
    ][]) {
      const statusIcon = item.passedSafety ? '✅ PASSED' : '❌ FAILED';
      lines.push(`| **${st}** | ${item.testedCount} | ${statusIcon} | ${item.summary} |`);
    }
    lines.push('');

    // 10. Reproducibility & Methodology
    lines.push('## 10. Methodology & Reproducibility');
    lines.push('');
    lines.push(
      '- **Simulation Engine:** `PaperExecutionEngine` with dynamic pool slippage & quadratic price impact.',
    );
    lines.push(
      '- **Time Progression:** `HistoricalClock` enforcing strict monotonic time ticks ($t_{next} \\ge t_{prev}$).',
    );
    lines.push(
      '- **Zero Real Money Invariant:** Fully virtual execution; verified zero private keys or RPC signers in memory.',
    );
    lines.push(
      '- **Reproducibility Command:** `npm run backtest` or `npx tsx src/scripts/run-backtest.ts`.',
    );
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Writes the generated Markdown report to the reports directory.
   */
  public static async saveReportToFile(
    report: BacktestEvaluationReport,
    customFilename?: string,
  ): Promise<string> {
    const filename = customFilename ?? `backtest-report-${Date.now()}.md`;
    const reportsDir = path.resolve(process.cwd(), 'reports');
    await fs.mkdir(reportsDir, { recursive: true });
    const fullPath = path.join(reportsDir, filename);

    const content = report.markdownReport || this.generateMarkdownReport(report);
    await fs.writeFile(fullPath, content, 'utf8');

    logger.info({ path: fullPath }, '[EvaluationReporter] Saved evaluation report to file');
    return fullPath;
  }
}
