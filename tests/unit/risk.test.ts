import { describe, it, expect } from 'vitest';
import { RiskService } from '../../src/modules/risk/risk.service.js';

describe('Risk Engine Module', () => {
  const riskService = new RiskService();

  it('passes a low-risk token with healthy distribution and liquidity', () => {
    const result = riskService.assess({
      mint: 'TestMint11111111111111111111111111111111111',
      symbol: 'SAFE',
      liquiditySol: 25.0,
      top10HoldingPct: 20.0,
      devHoldingPct: 4.0,
      hasValidMetadata: true,
      hasSocials: true,
      suspectedSniperCount: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it('flags token when top 10 holders exceed threshold', () => {
    const result = riskService.assess({
      mint: 'TestMint22222222222222222222222222222222222',
      symbol: 'RISKY_TOP10',
      liquiditySol: 30.0,
      top10HoldingPct: 55.0, // Limit is 30%
      devHoldingPct: 2.0,
      hasValidMetadata: true,
      hasSocials: true,
      suspectedSniperCount: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes('Top 10 holders'))).toBe(true);
  });

  it('flags token when dev wallet holding exceeds 10%', () => {
    const result = riskService.assess({
      mint: 'TestMint33333333333333333333333333333333333',
      symbol: 'RISKY_DEV',
      liquiditySol: 20.0,
      top10HoldingPct: 15.0,
      devHoldingPct: 18.0, // Limit is 10%
      hasValidMetadata: true,
      hasSocials: true,
      suspectedSniperCount: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('Developer wallet'))).toBe(true);
  });
});
