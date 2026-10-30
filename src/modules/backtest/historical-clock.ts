import { logger } from '../observability/logger.js';
import type { BacktestPriceQuote } from './backtest.types.js';

export class LookaheadBiasError extends Error {
  constructor(
    public readonly operation: string,
    public readonly clockTimestamp: number,
    public readonly futureTimestamp: number,
  ) {
    const diffMs = futureTimestamp - clockTimestamp;
    super(
      `[LOOKAHEAD BIAS VIOLATION] Operation "${operation}" attempted to access data from future timestamp ${futureTimestamp} (${new Date(futureTimestamp).toISOString()}) while simulation clock is at ${clockTimestamp} (${new Date(clockTimestamp).toISOString()}). Lookahead delta: +${diffMs}ms.`,
    );
    this.name = 'LookaheadBiasError';
  }
}

/**
 * Historical Clock for backtesting and point-in-time evaluation.
 * Requirement: Prevent look-ahead bias: A decision may only use information
 * available at its decision timestamp.
 */
export class HistoricalClock {
  private currentTimestamp: number;
  private readonly lookaheadViolations: Array<{
    operation: string;
    clockTime: number;
    futureTime: number;
  }> = [];

  constructor(initialTimestamp: number = 0) {
    this.currentTimestamp = initialTimestamp;
  }

  /**
   * Current simulation time in milliseconds.
   */
  public get now(): number {
    return this.currentTimestamp;
  }

  /**
   * Current simulation Date object.
   */
  public get nowDate(): Date {
    return new Date(this.currentTimestamp);
  }

  /**
   * Advances the simulation clock monotonically.
   * Throws if attempting to travel back in time.
   */
  public advanceTo(newTimestamp: number): void {
    if (newTimestamp < this.currentTimestamp) {
      throw new Error(
        `[HistoricalClock] Non-monotonic time travel rejected: Cannot move clock backwards from ${this.currentTimestamp} to ${newTimestamp}`,
      );
    }
    this.currentTimestamp = newTimestamp;
  }

  /**
   * Verifies that the given data timestamp is strictly <= simulation clock.
   * Throws LookaheadBiasError if lookahead is detected.
   */
  public assertNoLookahead(dataTimestamp: number, operation: string): void {
    // Tolerant up to 1ms for float/timestamp rounding, strictly forbid anything beyond
    if (dataTimestamp > this.currentTimestamp + 1) {
      this.lookaheadViolations.push({
        operation,
        clockTime: this.currentTimestamp,
        futureTime: dataTimestamp,
      });

      logger.error(
        {
          operation,
          clockTimestamp: this.currentTimestamp,
          futureTimestamp: dataTimestamp,
          clockIso: new Date(this.currentTimestamp).toISOString(),
          futureIso: new Date(dataTimestamp).toISOString(),
        },
        '[HistoricalClock] Lookahead bias violation detected',
      );

      throw new LookaheadBiasError(operation, this.currentTimestamp, dataTimestamp);
    }
  }

  /**
   * Filters price quotes to strictly those available at or before the current clock time.
   */
  public filterPointInTimeQuotes(quotes: BacktestPriceQuote[]): BacktestPriceQuote[] {
    return quotes.filter((q) => q.timestamp <= this.currentTimestamp);
  }

  /**
   * Obtains the latest available quote strictly at or before current clock time.
   */
  public getLatestAvailableQuote(quotes: BacktestPriceQuote[]): BacktestPriceQuote | null {
    const available = this.filterPointInTimeQuotes(quotes);
    if (available.length === 0) return null;
    return available[available.length - 1] ?? null;
  }

  /**
   * Returns lookahead audit violations count.
   */
  public get violations(): ReadonlyArray<{
    operation: string;
    clockTime: number;
    futureTime: number;
  }> {
    return this.lookaheadViolations;
  }

  /**
   * Resets clock to a new initial timestamp.
   */
  public reset(timestamp = 0): void {
    this.currentTimestamp = timestamp;
    this.lookaheadViolations.length = 0;
  }
}
