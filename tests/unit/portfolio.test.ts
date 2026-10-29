import { describe, it, expect, beforeEach } from 'vitest';
import { PortfolioService } from '../../src/modules/portfolio/portfolio.service.js';
import type { SimulatedExecutionResult } from '../../src/modules/execution/execution.types.js';

describe('Portfolio Accounting Module', () => {
  let portfolio: PortfolioService;

  beforeEach(() => {
    portfolio = new PortfolioService(10.0);
  });

  it('initializes with specified SOL balance and zero PnL', () => {
    const summary = portfolio.getSummary();
    expect(summary.initialSolBalance).toBe(10.0);
    expect(summary.currentSolBalance).toBe(10.0);
    expect(summary.realizedPnlSol).toBe(0);
    expect(summary.openPositionsCount).toBe(0);
  });

  it('updates balance and opens position on simulated BUY', () => {
    const mockBuy: SimulatedExecutionResult = {
      tradeId: 'sim_1',
      tokenMint: 'TokenA1111111111111111111111111111111111111',
      tokenSymbol: 'TKNA',
      side: 'BUY',
      requestedPriceSol: 0.001,
      executedPriceSol: 0.001,
      amountTokens: 1000,
      totalSol: 1.0,
      simulatedFeeSol: 0.005,
      slippageBpsApplied: 100,
      reason: 'Buy signal',
      executedAt: new Date(),
      isSimulated: true,
    };

    portfolio.recordTrade(mockBuy);

    // Balance should be: 10.0 - (1.0 + 0.005) = 8.995 SOL
    expect(portfolio.getSolBalance()).toBeCloseTo(8.995, 3);
    const positions = portfolio.getOpenPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.tokenSymbol).toBe('TKNA');
    expect(positions[0]?.solInvested).toBe(1.0);
  });

  it('calculates unrealized PnL on price changes', () => {
    portfolio.recordTrade({
      tradeId: 'sim_1',
      tokenMint: 'TokenA',
      tokenSymbol: 'TKNA',
      side: 'BUY',
      requestedPriceSol: 0.001,
      executedPriceSol: 0.001,
      amountTokens: 1000,
      totalSol: 1.0,
      simulatedFeeSol: 0.005,
      slippageBpsApplied: 100,
      reason: 'Buy',
      executedAt: new Date(),
      isSimulated: true,
    });

    // Price doubles to 0.002 SOL
    portfolio.updatePrice('TokenA', 0.002);

    const pos = portfolio.getPosition('TokenA');
    expect(pos?.unrealizedPnlSol).toBeCloseTo(1.0, 3);
    expect(pos?.unrealizedPnlPercent).toBeCloseTo(100.0, 1);
  });

  it('calculates realized PnL and updates win/loss count on simulated SELL', () => {
    portfolio.recordTrade({
      tradeId: 'sim_1',
      tokenMint: 'TokenA',
      tokenSymbol: 'TKNA',
      side: 'BUY',
      requestedPriceSol: 0.001,
      executedPriceSol: 0.001,
      amountTokens: 1000,
      totalSol: 1.0,
      simulatedFeeSol: 0.005,
      slippageBpsApplied: 100,
      reason: 'Buy',
      executedAt: new Date(),
      isSimulated: true,
    });

    // Sell all 1000 tokens at 0.0015 SOL (gross return = 1.5 SOL, fee = 0.005 => net return 1.495 SOL)
    portfolio.recordTrade({
      tradeId: 'sim_2',
      tokenMint: 'TokenA',
      tokenSymbol: 'TKNA',
      side: 'SELL',
      requestedPriceSol: 0.0015,
      executedPriceSol: 0.0015,
      amountTokens: 1000,
      totalSol: 1.5,
      simulatedFeeSol: 0.005,
      slippageBpsApplied: 100,
      reason: 'Take Profit',
      executedAt: new Date(),
      isSimulated: true,
    });

    const summary = portfolio.getSummary();
    expect(summary.openPositionsCount).toBe(0);
    expect(summary.winCount).toBe(1);
    expect(summary.lossCount).toBe(0);
    expect(summary.winRatePercent).toBe(100);
    // Realized PnL: 1.495 - 1.0 = +0.495 SOL
    expect(summary.realizedPnlSol).toBeCloseTo(0.495, 3);
  });
});
