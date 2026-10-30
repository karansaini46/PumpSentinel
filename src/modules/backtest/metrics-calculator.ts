import type {
  BacktestTrade,
  FinancialMetrics,
  RiskClassificationMetrics,
  MissedOpportunity,
  HistoricalTokenScenario,
} from './backtest.types.js';

export class MetricsCalculator {
  /**
   * Calculates comprehensive financial metrics from closed trades.
   * Requirement: Calculate win rate, net P&L after simulated costs, max drawdown,
   * profit factor, average win/loss, time in position, and sample size warnings.
   */
  public static calculateFinancialMetrics(
    trades: BacktestTrade[],
    startingBalanceSol: number = 10.0,
    solPriceUsd: number = 160.0,
  ): FinancialMetrics {
    const totalTrades = trades.length;
    let winCount = 0;
    let lossCount = 0;
    let breakevenCount = 0;
    let grossProfitSol = 0;
    let grossLossSol = 0;
    let totalSolInvested = 0;
    let totalFeesPaidSol = 0;
    const holdingDurations: number[] = [];

    // Running equity for drawdown computation
    let currentEquity = startingBalanceSol;
    let peakEquity = startingBalanceSol;
    let maxDrawdownSol = 0;
    let maxDrawdownPct = 0;

    for (const trade of trades) {
      totalSolInvested += trade.totalSolInvested;
      totalFeesPaidSol += trade.simulatedFeesSol;
      holdingDurations.push(trade.holdingDurationMs);

      if (trade.pnlSol > 0.000001) {
        winCount++;
        grossProfitSol += trade.pnlSol;
      } else if (trade.pnlSol < -0.000001) {
        lossCount++;
        grossLossSol += Math.abs(trade.pnlSol);
      } else {
        breakevenCount++;
      }

      currentEquity += trade.pnlSol;
      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }

      const currentDdSol = peakEquity - currentEquity;
      const currentDdPct = peakEquity > 0 ? (currentDdSol / peakEquity) * 100 : 0;

      if (currentDdSol > maxDrawdownSol) {
        maxDrawdownSol = currentDdSol;
      }
      if (currentDdPct > maxDrawdownPct) {
        maxDrawdownPct = currentDdPct;
      }
    }

    const netPnlSol = grossProfitSol - grossLossSol;
    const netPnlUsd = netPnlSol * solPriceUsd;
    const winRatePct = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
    const profitFactor =
      grossLossSol > 0
        ? grossProfitSol / grossLossSol
        : grossProfitSol > 0
          ? Number.POSITIVE_INFINITY
          : 0;

    const averageWinSol = winCount > 0 ? grossProfitSol / winCount : 0;
    const averageLossSol = lossCount > 0 ? grossLossSol / lossCount : 0;
    const winLossRatio =
      averageLossSol > 0
        ? averageWinSol / averageLossSol
        : averageWinSol > 0
          ? Number.POSITIVE_INFINITY
          : 0;

    // Holding duration metrics
    holdingDurations.sort((a, b) => a - b);
    const sumDurations = holdingDurations.reduce((sum, d) => sum + d, 0);
    const averageHoldingDurationMs = totalTrades > 0 ? sumDurations / totalTrades : 0;
    const medianHoldingDurationMs =
      totalTrades > 0
        ? totalTrades % 2 === 1
          ? holdingDurations[Math.floor(totalTrades / 2)]!
          : (holdingDurations[totalTrades / 2 - 1]! + holdingDurations[totalTrades / 2]!) / 2
        : 0;
    const minHoldingDurationMs = totalTrades > 0 ? holdingDurations[0]! : 0;
    const maxHoldingDurationMs = totalTrades > 0 ? holdingDurations[totalTrades - 1]! : 0;

    // Statistical Humility & Small Sample Warning
    // Requirement: Do not claim a strategy is profitable based on a small sample.
    const sampleSizeAdequate = totalTrades >= 30;
    const smallSampleWarning = !sampleSizeAdequate
      ? `⚠️ SMALL SAMPLE SIZE WARNING: Sample size (N = ${totalTrades} trades) is statistically insufficient (< 30 trades). Net P&L and win rate must not be interpreted as statistically significant or predictive of future market performance.`
      : null;

    // Standard error of proportion: SE = sqrt(p * (1 - p) / N)
    const p = totalTrades > 0 ? winCount / totalTrades : 0;
    const winRateStandardError = totalTrades > 0 ? Math.sqrt((p * (1 - p)) / totalTrades) * 100 : 0;

    // 95% Wilson Score Interval for win rate
    const z = 1.96; // 95% confidence
    let ciLower = 0;
    let ciUpper = 0;
    if (totalTrades > 0) {
      const denominator = 1 + (z * z) / totalTrades;
      const centerAdjusted = p + (z * z) / (2 * totalTrades);
      const rad =
        z * Math.sqrt((p * (1 - p)) / totalTrades + (z * z) / (4 * totalTrades * totalTrades));
      ciLower = Math.max(0, ((centerAdjusted - rad) / denominator) * 100);
      ciUpper = Math.min(100, ((centerAdjusted + rad) / denominator) * 100);
    }

    // Standard error of returns
    const meanReturn = totalTrades > 0 ? netPnlSol / totalTrades : 0;
    const variance =
      totalTrades > 1
        ? trades.reduce((acc, t) => acc + Math.pow(t.pnlSol - meanReturn, 2), 0) / (totalTrades - 1)
        : 0;
    const netPnlStandardErrorSol = totalTrades > 0 ? Math.sqrt(variance / totalTrades) : 0;

    return {
      totalTrades,
      winCount,
      lossCount,
      breakevenCount,
      winRatePct: Number(winRatePct.toFixed(2)),
      totalSolInvested: Number(totalSolInvested.toFixed(4)),
      netPnlSol: Number(netPnlSol.toFixed(4)),
      netPnlUsd: Number(netPnlUsd.toFixed(2)),
      grossProfitSol: Number(grossProfitSol.toFixed(4)),
      grossLossSol: Number(grossLossSol.toFixed(4)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : 999.99,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      maxDrawdownSol: Number(maxDrawdownSol.toFixed(4)),
      peakEquitySol: Number(peakEquity.toFixed(4)),
      endingEquitySol: Number(currentEquity.toFixed(4)),
      averageWinSol: Number(averageWinSol.toFixed(4)),
      averageLossSol: Number(averageLossSol.toFixed(4)),
      winLossRatio: Number.isFinite(winLossRatio) ? Number(winLossRatio.toFixed(2)) : 999.99,
      averageHoldingDurationMs: Math.round(averageHoldingDurationMs),
      medianHoldingDurationMs: Math.round(medianHoldingDurationMs),
      minHoldingDurationMs,
      maxHoldingDurationMs,
      totalFeesPaidSol: Number(totalFeesPaidSol.toFixed(4)),
      sampleSizeAdequate,
      smallSampleWarning,
      winRateStandardError: Number(winRateStandardError.toFixed(2)),
      winRateConfidenceInterval95: [Number(ciLower.toFixed(1)), Number(ciUpper.toFixed(1))],
      netPnlStandardErrorSol: Number(netPnlStandardErrorSol.toFixed(4)),
    };
  }

  /**
   * Calculates classification metrics against ground-truth labels (RUG_PULL vs LEGITIMATE).
   * Requirement: False-positive and false-negative risk classifications where ground-truth labels exist.
   */
  public static calculateRiskClassification(
    evaluations: Array<{
      scenario: HistoricalTokenScenario;
      passed: boolean;
      reasons: string[];
      score: number;
    }>,
  ): RiskClassificationMetrics {
    let tp = 0; // True Positive: Rug pull correctly rejected
    let fp = 0; // False Positive: Legitimate token incorrectly rejected (false alarm)
    let tn = 0; // True Negative: Legitimate token correctly allowed
    let fn = 0; // False Negative: Rug pull mistakenly allowed (disaster)

    let totalLabeled = 0;

    for (const ev of evaluations) {
      const gt = ev.scenario.groundTruth;
      if (gt === 'UNKNOWN') continue;

      totalLabeled++;
      const wasRejected = !ev.passed;

      if (gt === 'RUG_PULL') {
        if (wasRejected) {
          tp++; // Caught the rug
        } else {
          fn++; // Missed the rug
        }
      } else if (gt === 'LEGITIMATE') {
        if (!wasRejected) {
          tn++; // Allowed legitimate token
        } else {
          fp++; // False alarm
        }
      }
    }

    const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 100;
    const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 100; // Scam Catch Rate
    const specificity = tn + fp > 0 ? (tn / (tn + fp)) * 100 : 100;
    const f1 = precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) / 100 : 0;
    const accuracy = totalLabeled > 0 ? ((tp + tn) / totalLabeled) * 100 : 0;

    return {
      totalLabeledTokens: totalLabeled,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precisionPct: Number(precision.toFixed(1)),
      recallPct: Number(recall.toFixed(1)),
      specificityPct: Number(specificity.toFixed(1)),
      f1Score: Number(f1.toFixed(3)),
      accuracyPct: Number(accuracy.toFixed(1)),
    };
  }

  /**
   * Identifies missed opportunities: Tokens rejected by risk filter that subsequent pumped > 20%.
   */
  public static identifyMissedOpportunities(
    rejectedScenarios: Array<{
      scenario: HistoricalTokenScenario;
      reasons: string[];
      score: number;
    }>,
    minPumpThresholdPct = 20.0,
  ): MissedOpportunity[] {
    const missed: MissedOpportunity[] = [];

    for (const item of rejectedScenarios) {
      const quotes = item.scenario.priceHistory;
      if (quotes.length < 2) continue;

      const initialPrice = quotes[0]!.priceSol;
      let peakPrice = initialPrice;

      for (const q of quotes) {
        if (q.priceSol > peakPrice) {
          peakPrice = q.priceSol;
        }
      }

      const pumpPct = initialPrice > 0 ? ((peakPrice - initialPrice) / initialPrice) * 100 : 0;

      if (pumpPct >= minPumpThresholdPct) {
        missed.push({
          tokenMint: item.scenario.mint,
          tokenSymbol: item.scenario.symbol,
          discoveryTimestamp: item.scenario.discoveryEvent.timestamp,
          initialPriceSol: initialPrice,
          peakPriceSol: peakPrice,
          maxPumpPct: Number(pumpPct.toFixed(1)),
          rejectionReasons: item.reasons,
          rejectionScore: item.score,
        });
      }
    }

    return missed;
  }
}
