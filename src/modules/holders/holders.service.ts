import type { TokenHolder, HolderAnalysisSummary } from './holders.types.js';

export class HoldersService {
  public analyzeHolders(
    mint: string,
    creatorAddress: string,
    bondingCurveAddress: string,
    holders: TokenHolder[],
  ): HolderAnalysisSummary {
    const totalHolders = holders.length;

    // Filter out bonding curve to get true community/dev distribution
    const nonCurveHolders = holders.filter((h) => h.address !== bondingCurveAddress);
    const sortedHolders = [...nonCurveHolders].sort((a, b) => b.percentage - a.percentage);

    const top10 = sortedHolders.slice(0, 10);
    const top10Percentage = top10.reduce((acc, h) => acc + h.percentage, 0);

    const devHolder = holders.find((h) => h.address === creatorAddress);
    const devHoldingPercentage = devHolder ? devHolder.percentage : 0;

    const curveHolder = holders.find((h) => h.address === bondingCurveAddress);
    const bondingCurvePercentage = curveHolder ? curveHolder.percentage : 0;

    const suspectedSniperCount = holders.filter((h) => h.isSuspectedSniper).length;
    const hasHighConcentration = top10Percentage > 30 || devHoldingPercentage > 10;

    return {
      mint,
      creatorAddress,
      totalHolders,
      top10Percentage: Math.round(top10Percentage * 100) / 100,
      devHoldingPercentage: Math.round(devHoldingPercentage * 100) / 100,
      bondingCurvePercentage: Math.round(bondingCurvePercentage * 100) / 100,
      suspectedSniperCount,
      hasHighConcentration,
      analyzedAt: new Date(),
    };
  }
}

export const holdersService = new HoldersService();
