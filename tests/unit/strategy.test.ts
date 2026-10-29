import { describe, it, expect } from 'vitest';
import { StrategyService } from '../../src/modules/strategy/strategy.service.js';
import type { PaperPosition } from '../../src/modules/persistence/persistence.types.js';

describe('Strategy Module', () => {
  it('triggers BUY signal when safe token discovered and auto-trade is enabled', () => {
    const strategy = new StrategyService({ autoTradeEnabled: true, fixedBuyAmountSol: 0.5 });
    const signal = strategy.evaluateEntry(
      {
        mint: 'Mint123',
        name: 'SafeCoin',
        symbol: 'SAFE',
        uri: 'https://example.com/meta.json',
        creator: 'Dev123',
        initialLiquiditySol: 30,
        bondingCurveProgress: 0,
        discoveredAt: new Date(),
        signature: 'mock_sig_1',
        slot: 100,
        onChainTimestamp: new Date(),
        discoveryLatencyMs: 50,
        source: 'onchain',
        isSynthetic: false,
        lifecycleState: 'ELIGIBLE_FOR_RISK_ANALYSIS',
        metadataStatus: 'RESOLVED',
      },
      {
        mint: 'Mint123',
        score: 0,
        passed: true,
        reasons: [],
        assessedAt: new Date(),
      },
      0,
    );

    expect(signal.action).toBe('BUY');
    expect(signal.sizeSol).toBe(0.5);
  });

  it('triggers TAKE PROFIT exit when price increases above threshold', () => {
    const strategy = new StrategyService({ takeProfitPct: 50, stopLossPct: 20 });
    const position: PaperPosition = {
      id: 'pos_1',
      tokenMint: 'Mint123',
      tokenSymbol: 'SAFE',
      status: 'OPEN',
      amountTokens: 1000,
      entryPriceSol: 0.001,
      currentPriceSol: 0.001,
      solInvested: 1.0,
      realizedPnlSol: 0,
      unrealizedPnlSol: 0,
      openedAt: new Date(),
      closedAt: null,
      updatedAt: new Date(),
    };

    // +60% price increase (0.0016)
    const exitSignal = strategy.evaluateExit(position, 0.0016);
    expect(exitSignal.action).toBe('SELL');
    expect(exitSignal.reason).toContain('Take profit target hit');
  });

  it('triggers STOP LOSS exit when price drops below threshold', () => {
    const strategy = new StrategyService({ takeProfitPct: 50, stopLossPct: 20 });
    const position: PaperPosition = {
      id: 'pos_1',
      tokenMint: 'Mint123',
      tokenSymbol: 'SAFE',
      status: 'OPEN',
      amountTokens: 1000,
      entryPriceSol: 0.001,
      currentPriceSol: 0.001,
      solInvested: 1.0,
      realizedPnlSol: 0,
      unrealizedPnlSol: 0,
      openedAt: new Date(),
      closedAt: null,
      updatedAt: new Date(),
    };

    // -25% price drop (0.00075)
    const exitSignal = strategy.evaluateExit(position, 0.00075);
    expect(exitSignal.action).toBe('SELL');
    expect(exitSignal.reason).toContain('Stop loss threshold triggered');
  });
});
