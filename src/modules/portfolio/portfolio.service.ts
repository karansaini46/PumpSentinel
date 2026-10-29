import crypto from 'node:crypto';
import type { PositionDetails, PortfolioSummary } from './portfolio.types.js';
import type { SimulatedExecutionResult } from '../execution/execution.types.js';
import { logger } from '../observability/logger.js';

export class PortfolioService {
  private initialSolBalance: number;
  private currentSolBalance: number;
  private realizedPnlSol = 0;
  private winCount = 0;
  private lossCount = 0;
  private totalTrades = 0;
  private openPositions = new Map<string, PositionDetails>(); // Keyed by tokenMint

  constructor(initialBalance = 10.0) {
    this.initialSolBalance = initialBalance;
    this.currentSolBalance = initialBalance;
  }

  public reset(initialBalance = 10.0): void {
    this.initialSolBalance = initialBalance;
    this.currentSolBalance = initialBalance;
    this.realizedPnlSol = 0;
    this.winCount = 0;
    this.lossCount = 0;
    this.totalTrades = 0;
    this.openPositions.clear();
    logger.info({ initialBalance }, '[PortfolioService] Portfolio reset');
  }

  public getSolBalance(): number {
    return this.currentSolBalance;
  }

  public getOpenPositions(): PositionDetails[] {
    return Array.from(this.openPositions.values());
  }

  public getPosition(mint: string): PositionDetails | undefined {
    return this.openPositions.get(mint);
  }

  public recordTrade(trade: SimulatedExecutionResult): void {
    this.totalTrades += 1;

    if (trade.side === 'BUY') {
      const totalCost = trade.totalSol + trade.simulatedFeeSol;
      if (this.currentSolBalance < totalCost) {
        throw new Error(
          `Insufficient simulated SOL balance: have ${this.currentSolBalance.toFixed(4)}, need ${totalCost.toFixed(4)}`,
        );
      }

      this.currentSolBalance -= totalCost;

      const existing = this.openPositions.get(trade.tokenMint);
      if (existing) {
        // Average up/down
        const combinedTokens = existing.amountTokens + trade.amountTokens;
        const combinedCost = existing.solInvested + trade.totalSol;
        existing.amountTokens = combinedTokens;
        existing.solInvested = combinedCost;
        existing.entryPriceSol = combinedCost / combinedTokens;
        existing.currentPriceSol = trade.executedPriceSol;
      } else {
        const newPosition: PositionDetails = {
          id: `pos_${crypto.randomUUID()}`,
          tokenMint: trade.tokenMint,
          tokenSymbol: trade.tokenSymbol,
          amountTokens: trade.amountTokens,
          entryPriceSol: trade.executedPriceSol,
          currentPriceSol: trade.executedPriceSol,
          solInvested: trade.totalSol,
          unrealizedPnlSol: 0,
          unrealizedPnlPercent: 0,
          openedAt: trade.executedAt,
        };
        this.openPositions.set(trade.tokenMint, newPosition);
      }
    } else {
      // SELL trade
      const existing = this.openPositions.get(trade.tokenMint);
      if (!existing) {
        throw new Error(`Cannot SELL: No open paper position found for mint ${trade.tokenMint}`);
      }

      const grossReturnSol = trade.totalSol;
      const netReturnSol = grossReturnSol - trade.simulatedFeeSol;
      this.currentSolBalance += netReturnSol;

      const fractionSold = Math.min(1.0, trade.amountTokens / existing.amountTokens);
      const costBasisSold = existing.solInvested * fractionSold;
      const tradePnlSol = netReturnSol - costBasisSold;

      this.realizedPnlSol += tradePnlSol;
      if (tradePnlSol > 0) {
        this.winCount += 1;
      } else {
        this.lossCount += 1;
      }

      if (fractionSold >= 0.999) {
        this.openPositions.delete(trade.tokenMint);
      } else {
        existing.amountTokens -= trade.amountTokens;
        existing.solInvested -= costBasisSold;
      }
    }
  }

  public updatePrice(mint: string, currentPriceSol: number): void {
    const pos = this.openPositions.get(mint);
    if (!pos) return;

    pos.currentPriceSol = currentPriceSol;
    const currentValue = pos.amountTokens * currentPriceSol;
    pos.unrealizedPnlSol = currentValue - pos.solInvested;
    pos.unrealizedPnlPercent =
      pos.solInvested > 0 ? (pos.unrealizedPnlSol / pos.solInvested) * 100 : 0;
  }

  public getSummary(): PortfolioSummary {
    let totalInvestedSol = 0;
    let unrealizedPnlSol = 0;
    let openPositionsValueSol = 0;

    for (const pos of this.openPositions.values()) {
      totalInvestedSol += pos.solInvested;
      const posVal = pos.amountTokens * pos.currentPriceSol;
      openPositionsValueSol += posVal;
      unrealizedPnlSol += posVal - pos.solInvested;
    }

    const totalPortfolioValueSol = this.currentSolBalance + openPositionsValueSol;
    const totalPnlSol = this.realizedPnlSol + unrealizedPnlSol;
    const totalPnlPercent =
      this.initialSolBalance > 0 ? (totalPnlSol / this.initialSolBalance) * 100 : 0;

    const closedTrades = this.winCount + this.lossCount;
    const winRatePercent = closedTrades > 0 ? (this.winCount / closedTrades) * 100 : 0;

    return {
      initialSolBalance: this.round(this.initialSolBalance),
      currentSolBalance: this.round(this.currentSolBalance),
      totalInvestedSol: this.round(totalInvestedSol),
      realizedPnlSol: this.round(this.realizedPnlSol),
      unrealizedPnlSol: this.round(unrealizedPnlSol),
      totalPortfolioValueSol: this.round(totalPortfolioValueSol),
      totalPnlSol: this.round(totalPnlSol),
      totalPnlPercent: this.round(totalPnlPercent),
      openPositionsCount: this.openPositions.size,
      winCount: this.winCount,
      lossCount: this.lossCount,
      winRatePercent: this.round(winRatePercent),
      totalTrades: this.totalTrades,
    };
  }

  private round(val: number): number {
    return Math.round(val * 10000) / 10000;
  }
}

export const portfolioService = new PortfolioService();
