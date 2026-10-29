import { describe, it, expect } from 'vitest';
import { DataReconciler } from '../../src/modules/analysis/reconciliation/data-reconciler.js';
import { TokenAnalysisService } from '../../src/modules/analysis/token-analysis.service.js';
import { SyntheticAnalysisProvider } from '../../src/modules/analysis/providers/synthetic-analysis-provider.js';
import { UNKNOWN } from '../../src/modules/analysis/analysis.types.js';

describe('Analysis Edge Cases: Missing, Stale, Contradictory, and Malformed Data', () => {
  const reconciler = new DataReconciler();

  // -------------------------------------------------------------------------
  // 1. Missing Data Requirements
  // "Represent unavailable data as UNKNOWN, never as zero."
  // -------------------------------------------------------------------------
  describe('Missing Data', () => {
    it('represents unavailable numeric data as UNKNOWN, never as 0', () => {
      const field = reconciler.reconcileNumeric('tradingVolume', [
        { source: 'provider_a', value: null },
        { source: 'provider_b', value: undefined },
      ]);

      expect(field.value).toBe(UNKNOWN);
      expect(field.value).not.toBe(0);
      expect(field.status).toBe('UNKNOWN');
      expect(field.confidence).toBe('LOW');
      expect(field.confidenceScore).toBe(0.0);
      expect(field.reason).toContain('Data unavailable');
    });

    it('represents missing address as UNKNOWN, never as empty string', () => {
      const field = reconciler.reconcileAddress('creatorWallet', [
        { source: 'rpc', value: null },
        { source: 'indexer', value: '' },
      ]);

      expect(field.value).toBe(UNKNOWN);
      expect(field.value).not.toBe('');
      expect(field.status).toBe('UNKNOWN');
      expect(field.reason).toContain('unavailable');
    });

    it('represents missing authority info as UNKNOWN with status UNKNOWN', () => {
      const result = reconciler.reconcileAuthority('freezeAuthority', []);

      expect(result.authority.value).toBe(UNKNOWN);
      expect(result.isRevoked.value).toBe(UNKNOWN);
      expect(result.authority.status).toBe('UNKNOWN');
    });

    it('service represents entire missing sections as UNKNOWN when provider exposes no data', async () => {
      const missingProvider = new SyntheticAnalysisProvider({
        simulateMissingFields: true,
      });
      const service = new TokenAnalysisService(missingProvider);

      const report = await service.analyzeToken('SyntHMissing11111111111111111111111111111', {
        bypassCache: true,
      });

      expect(report.supply.supply.value).toBe(UNKNOWN);
      expect(report.supply.supply.value).not.toBe(0);
      expect(report.supply.decimals.value).toBe(UNKNOWN);
      expect(report.supply.decimals.value).not.toBe(0);
      expect(report.volume.totalVolumeSol.value).toBe(UNKNOWN);
      expect(report.volume.totalVolumeSol.value).not.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Stale Data Requirements
  // "For every field record: Data freshness, observation timestamp"
  // -------------------------------------------------------------------------
  describe('Stale Data', () => {
    it('flags data older than stale threshold as STALE and downgrades confidence', () => {
      const fiveMinutesAgo = new Date(Date.now() - 300_000);

      const field = reconciler.reconcileNumeric(
        'currentPrice',
        [{ source: 'dex_cache', value: 0.00042, observedAt: fiveMinutesAgo, priority: 5 }],
        { staleThresholdMs: 60_000 },
      );

      expect(field.value).toBe(0.00042);
      expect(field.status).toBe('STALE');
      expect(field.freshness).toBe('EXPIRED');
      expect(field.freshnessMs).toBeGreaterThanOrEqual(290_000);
      expect(field.confidence).toBe('LOW');
      expect(field.confidenceScore).toBeLessThan(0.5);
    });

    it('treats recently observed data as FRESH with CONFIRMED status', () => {
      const recent = new Date(Date.now() - 500);

      const field = reconciler.reconcileNumeric(
        'liquiditySol',
        [{ source: 'onchain_rpc', value: 25.5, observedAt: recent, priority: 10 }],
        { staleThresholdMs: 60_000 },
      );

      expect(field.value).toBe(25.5);
      expect(field.status).toBe('CONFIRMED');
      expect(field.freshness).toBe('FRESH');
      expect(field.confidence).toBe('HIGH');
    });

    it('service tracks stale fields in overall summary', async () => {
      const staleProvider = new SyntheticAnalysisProvider({
        simulateStaleFields: true,
        staleAgeMs: 240_000, // 4 minutes
      });
      const service = new TokenAnalysisService(staleProvider);

      const report = await service.analyzeToken('SyntHStale111111111111111111111111111111', {
        bypassCache: true,
      });

      expect(report.supply.supply.status).toBe('STALE');
      expect(report.supply.supply.freshness).toBe('STALE');
      expect(report.overallSummary.staleFieldCount).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Contradictory Data Requirements
  // -------------------------------------------------------------------------
  describe('Contradictory Data', () => {
    it('detects numeric contradictions between competing providers and documents conflict', () => {
      const field = reconciler.reconcileNumeric('totalSupply', [
        { source: 'onchain_rpc', value: 1_000_000_000, priority: 10 },
        { source: 'third_party_api', value: 500_000_000, priority: 5 },
      ]);

      expect(field.status).toBe('CONTRADICTORY');
      expect(field.value).toBe(1_000_000_000); // Reconciled to higher authority
      expect(field.confidence).toBe('LOW');
      expect(field.confidenceScore).toBeLessThanOrEqual(0.3);
      expect(field.reason).toContain('Contradiction detected');
      expect(field.reason).toContain('third_party_api=500000000');
    });

    it('detects authority contradiction when one source claims active and another claims revoked', () => {
      const result = reconciler.reconcileAuthority('freezeAuthority', [
        {
          source: 'external_token_list',
          value: 'AuthActive1111111111111111111111111111111111',
        },
        { source: 'onchain_mint_account', value: null },
      ]);

      expect(result.authority.status).toBe('CONTRADICTORY');
      expect(result.isRevoked.status).toBe('CONTRADICTORY');
      expect(result.authority.reason).toContain('Contradictory authority status');
      expect(result.authority.confidence).toBe('LOW');
    });

    it('service records contradictory fields in report summary', async () => {
      const contradictionProvider = new SyntheticAnalysisProvider({
        simulateContradictions: true,
      });
      const service = new TokenAnalysisService(contradictionProvider);

      const report = await service.analyzeToken('SyntHConflict11111111111111111111111111111', {
        bypassCache: true,
      });

      expect(report.authorities.mintAuthority.status).toBe('CONTRADICTORY');
      expect(report.authorities.freezeAuthority.status).toBe('CONTRADICTORY');
      expect(report.overallSummary.contradictoryFieldCount).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Malformed Data Requirements
  // -------------------------------------------------------------------------
  describe('Malformed Data', () => {
    it('rejects negative supply or balances without crashing and marks as UNKNOWN', () => {
      const field = reconciler.reconcileNumeric(
        'supply',
        [{ source: 'corrupted_rpc', value: -1_000_000 }],
        { min: 0 },
      );

      expect(field.value).toBe(UNKNOWN);
      expect(field.value).not.toBe(-1_000_000);
      expect(field.status).toBe('UNKNOWN');
      expect(field.reason).toContain('below minimum allowed');
    });

    it('rejects non-numeric NaN values and records malformed reason', () => {
      const field = reconciler.reconcileNumeric('decimals', [
        { source: 'malformed_api', value: 'NOT_A_NUMBER' as unknown as number },
      ]);

      expect(field.value).toBe(UNKNOWN);
      expect(field.status).toBe('UNKNOWN');
      expect(field.reason).toContain('not a finite number');
    });

    it('rejects non-base58 and invalid-length Solana addresses gracefully', () => {
      const field = reconciler.reconcileAddress('mintAddress', [
        { source: 'corrupted_feed', value: '0x1234567890abcdef-not-base58!!!' },
      ]);

      expect(field.value).toBe(UNKNOWN);
      expect(field.status).toBe('UNKNOWN');
      expect(field.reason).toContain('not a valid 32-byte Solana address');
    });

    it('handles out-of-bounds percentages (> 100%) gracefully', () => {
      const field = reconciler.reconcileNumeric(
        'devHoldingPct',
        [{ source: 'buggy_indexer', value: 150.0 }],
        { min: 0, max: 100 },
      );

      expect(field.value).toBe(UNKNOWN);
      expect(field.status).toBe('UNKNOWN');
      expect(field.reason).toContain('above maximum allowed');
    });
  });
});
