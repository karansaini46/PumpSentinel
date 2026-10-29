import { describe, it, expect } from 'vitest';
import { PaperExecutionEngine } from '../../src/modules/execution/paper-engine.service.js';

describe('Paper Execution Module', () => {
  const engine = new PaperExecutionEngine({
    defaultSlippageBps: 100, // 1%
    simulatedFeeSol: 0.005,
  });

  it('correctly simulates a BUY trade with slippage and fee calculation', () => {
    const trade = engine.executeSimulatedOrder({
      tokenMint: 'MintABC111111111111111111111111111111111111',
      tokenSymbol: 'TEST',
      side: 'BUY',
      solAmount: 1.0,
      currentPriceSol: 0.001,
      reason: 'Test BUY order',
      bypassRiskGateForTestingOnly: true,
    });

    expect(trade.isSimulated).toBe(true);
    expect(trade.side).toBe('BUY');
    expect(trade.tradeId).toMatch(/^sim_/);
    // Requested price = 0.001. With +1% slippage => 0.00101
    expect(trade.executedPriceSol).toBeCloseTo(0.00101, 6);
    expect(trade.totalSol).toBe(1.0);
    expect(trade.simulatedFeeSol).toBe(0.005);
    // Tokens = 1.0 / 0.00101 ≈ 990.099
    expect(trade.amountTokens).toBeCloseTo(990.099, 1);
  });

  it('correctly simulates a SELL trade with downward slippage', () => {
    const trade = engine.executeSimulatedOrder({
      tokenMint: 'MintABC111111111111111111111111111111111111',
      tokenSymbol: 'TEST',
      side: 'SELL',
      tokenAmount: 1000,
      currentPriceSol: 0.002,
      reason: 'Test SELL order',
    });

    expect(trade.side).toBe('SELL');
    // Requested price = 0.002. With -1% slippage => 0.00198
    expect(trade.executedPriceSol).toBeCloseTo(0.00198, 6);
    // Total SOL = 1000 * 0.00198 = 1.98 SOL
    expect(trade.totalSol).toBeCloseTo(1.98, 4);
    expect(trade.simulatedFeeSol).toBe(0.005);
  });

  it('STRICT INVARIANT: throws error if real private key is injected', () => {
    process.env['PRIVATE_KEY'] = 'fake_key';

    expect(() => {
      new PaperExecutionEngine();
    }).toThrow(/FATAL: Real private key detected/);

    delete process.env['PRIVATE_KEY'];
  });
});
