import { describe, it, expect } from 'vitest';
import { HoldersService } from '../../src/modules/holders/holders.service.js';
import type { TokenHolder } from '../../src/modules/holders/holders.types.js';

describe('Holder Analysis Module', () => {
  const service = new HoldersService();

  it('calculates top 10 percentage excluding bonding curve', () => {
    const holders: TokenHolder[] = [
      {
        address: 'BondingCurve111',
        balance: 800000,
        percentage: 80,
        isCreator: false,
        isBondingCurve: true,
      },
      {
        address: 'WalletDev111',
        balance: 50000,
        percentage: 5,
        isCreator: true,
        isBondingCurve: false,
      },
      {
        address: 'WalletTop1',
        balance: 60000,
        percentage: 6,
        isCreator: false,
        isBondingCurve: false,
      },
      {
        address: 'WalletTop2',
        balance: 40000,
        percentage: 4,
        isCreator: false,
        isBondingCurve: false,
      },
    ];

    const summary = service.analyzeHolders('Mint111', 'WalletDev111', 'BondingCurve111', holders);

    expect(summary.devHoldingPercentage).toBe(5);
    expect(summary.bondingCurvePercentage).toBe(80);
    // Non-curve sum: 6 + 5 + 4 = 15%
    expect(summary.top10Percentage).toBe(15);
    expect(summary.hasHighConcentration).toBe(false);
  });
});
