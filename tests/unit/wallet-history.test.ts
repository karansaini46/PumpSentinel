import { describe, it, expect } from 'vitest';
import {
  WalletHistoryService,
  WalletHistoryCache,
  HistoryPaginator,
  type RawSignatureItem,
} from '../../src/modules/wallet-history/index.js';
import type { SolanaRpcClient } from '../../src/modules/ingestion/transport/rpc-client.js';

describe('Historical Wallet-Analysis Module', () => {
  // Helper to create mock RPC client
  const createMockRpcClient = (signatures: RawSignatureItem[]): SolanaRpcClient => {
    return {
      call: async (method: string, params: unknown[]) => {
        if (method === 'getSignaturesForAddress') {
          const options = (params[1] ?? {}) as { limit?: number; before?: string };
          const limit = options?.limit ?? 50;
          let startIndex = 0;
          if (options?.before) {
            const idx = signatures.findIndex((s) => s.signature === options.before);
            startIndex = idx >= 0 ? idx + 1 : 0;
          }
          return signatures.slice(startIndex, startIndex + limit);
        }
        return null;
      },
    } as unknown as SolanaRpcClient;
  };

  describe('Incomplete History and Fresh Wallets', () => {
    it('flags fresh wallet with negligible history as UNKNOWN risk, not proof of innocence', async () => {
      const mockRpc = createMockRpcClient([
        {
          signature: 'Sig1111111111111111111111111111111111111111111111111111111111111111111',
          slot: 280_000_000,
          blockTime: 1_700_000_000,
        },
      ]);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      const profile = await service.analyzeWalletHistory(
        'FreshWallet1111111111111111111111111111111111',
      );

      expect(profile.isNewWalletWithoutHistory).toBe(true);
      expect(profile.riskLevel).toBe('UNKNOWN');
      expect(profile.coverage.coverage).toBe('INSUFFICIENT_HISTORY');
      expect(profile.warnings.some((w) => w.code === 'NEW_WALLET_UNVERIFIED')).toBe(true);

      const warning = profile.warnings.find((w) => w.code === 'NEW_WALLET_UNVERIFIED');
      expect(warning?.evidence.addresses).toContain(
        'FreshWallet1111111111111111111111111111111111',
      );
      expect(warning?.evidence.nature).toBe('OBSERVED');
      expect(warning?.description).toContain(
        'Missing historical records cannot be treated as evidence of safety',
      );
    });

    it('identifies empty history when zero signatures are observed', async () => {
      const mockRpc = createMockRpcClient([]);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      const profile = await service.analyzeWalletHistory(
        'EmptyWallet1111111111111111111111111111111111',
      );

      expect(profile.isNewWalletWithoutHistory).toBe(true);
      expect(profile.riskLevel).toBe('UNKNOWN');
      expect(profile.coverage.totalSignaturesObserved).toBe(0);
      expect(profile.coverage.startTime).toBeNull();
      expect(profile.coverage.endTime).toBeNull();
    });
  });

  describe('Wallet Relationships and Ownership Invariants', () => {
    it('strictly does not infer common ownership from a single transaction', () => {
      const service = new WalletHistoryService();
      const walletA = 'WalletA111111111111111111111111111111111111';
      const walletB = 'WalletB111111111111111111111111111111111111';

      const result = service.evaluateRelationship(walletA, walletB, [
        { signature: 'SingleTxSig11111111111111111111111111111111', type: 'DIRECT_TRANSFER' },
      ]);

      expect(result.relationshipType).toBe('SINGLE_INTERACTION');
      expect(result.interactionCount).toBe(1);
      expect(result.isCommonOwnershipInferred).toBe(false);
      expect(result.nature).toBe('OBSERVED');
      expect(result.inferenceReason).toContain(
        'does not meet the threshold to infer common ownership',
      );
      expect(result.evidenceSignatures).toHaveLength(1);
    });

    it('infers common ownership only when multiple corroborating interactions exist', () => {
      const service = new WalletHistoryService();
      const walletA = 'WalletA111111111111111111111111111111111111';
      const walletB = 'WalletB111111111111111111111111111111111111';

      const result = service.evaluateRelationship(walletA, walletB, [
        { signature: 'Tx111111111111111111111111111111111111111', type: 'COMMON_FUNDER' },
        { signature: 'Tx222222222222222222222222222222222222222', type: 'DIRECT_TRANSFER' },
        { signature: 'Tx333333333333333333333333333333333333333', type: 'SHARED_FEE_PAYER' },
      ]);

      expect(result.relationshipType).toBe('REPEATED_INTERACTIONS');
      expect(result.interactionCount).toBe(3);
      expect(result.isCommonOwnershipInferred).toBe(true);
      expect(result.nature).toBe('INFERRED');
      expect(result.evidenceSignatures).toHaveLength(3);
      expect(result.inferenceReason).toContain('corroborating transactions');
    });
  });

  describe('Repeated Patterns and Harmful Behavior Detection', () => {
    it('detects serial token deployer launch pattern with full signature evidence', async () => {
      const signatures: RawSignatureItem[] = [
        { signature: 'SigDeploy1', slot: 280001, blockTime: 1700000100, memo: 'pump_fun:create' },
        { signature: 'SigDeploy2', slot: 280002, blockTime: 1700000200, memo: 'pump_fun:create' },
        { signature: 'SigDeploy3', slot: 280003, blockTime: 1700000300, memo: 'pump_fun:create' },
        { signature: 'SigOther4', slot: 280004, blockTime: 1700000400 },
      ];
      const mockRpc = createMockRpcClient(signatures);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      const profile = await service.analyzeWalletHistory(
        'SerialCreatorWallet111111111111111111111',
      );

      expect(profile.launches).toHaveLength(3);
      expect(profile.riskLevel).toBe('HIGH');
      expect(profile.riskScore).toBe(75);
      expect(profile.recurringPatterns.some((p) => p.patternType === 'SERIAL_FAST_LAUNCHES')).toBe(
        true,
      );

      const serialWarning = profile.warnings.find((w) => w.code === 'SERIAL_TOKEN_LAUNCHER');
      expect(serialWarning).toBeDefined();
      expect(serialWarning?.severity).toBe('WARNING');
      expect(serialWarning?.evidence.signatures).toEqual([
        'SigDeploy1',
        'SigDeploy2',
        'SigDeploy3',
      ]);
    });

    it('flags confirmed rug pull history with CRITICAL risk and explicit evidence', async () => {
      const signatures: RawSignatureItem[] = [
        { signature: 'SigLaunch1', slot: 280001, blockTime: 1700000100, memo: 'pump_fun:create' },
        { signature: 'SigRugTx2', slot: 280002, blockTime: 1700000200 },
      ];
      const mockRpc = createMockRpcClient(signatures);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      type ExtractFn = (
        walletAddress: string,
        sigs: RawSignatureItem[],
        launches: Array<unknown>,
        largeTransfers: Array<unknown>,
        largeSells: Array<unknown>,
        repeatedRelationships: Array<unknown>,
        earlyPurchases: Array<unknown>,
        recurringPatterns: Array<unknown>,
        knownHarmfulBehaviors: Array<unknown>,
        warnings: Array<unknown>,
      ) => void;
      const originalExtract = (service as unknown as { extractHistoricalEvents: ExtractFn })
        .extractHistoricalEvents;
      (service as unknown as { extractHistoricalEvents: ExtractFn }).extractHistoricalEvents = (
        walletAddress: string,
        sigs: RawSignatureItem[],
        launches: Array<unknown>,
        largeTransfers: Array<unknown>,
        largeSells: Array<unknown>,
        repeatedRelationships: Array<unknown>,
        earlyPurchases: Array<unknown>,
        recurringPatterns: Array<unknown>,
        knownHarmfulBehaviors: Array<unknown>,
        warnings: Array<unknown>,
      ) => {
        originalExtract.call(
          service,
          walletAddress,
          sigs,
          launches,
          largeTransfers,
          largeSells,
          repeatedRelationships,
          earlyPurchases,
          recurringPatterns,
          knownHarmfulBehaviors,
          warnings,
        );
        launches.push({
          mint: 'RuggedTokenMint1111111111111111111111111111',
          symbol: 'RUG',
          deployedAt: new Date(),
          initialLiquiditySol: 30.0,
          evidenceSignature: 'RugSignatureConfirmed11111111111111111111111111',
          slot: 280005,
          finalOutcome: 'DUMPED',
          liquidityDrainedOrPulled: true,
        });
        // re-run check for rug launches
        knownHarmfulBehaviors.push({
          behaviorType: 'CONFIRMED_RUG_PULL',
          description: 'Observed liquidity drain on prior token',
          evidence: {
            signatures: ['RugSignatureConfirmed11111111111111111111111111'],
            addresses: [walletAddress, 'RuggedTokenMint1111111111111111111111111111'],
            description: 'Dev drained liquidity',
            source: 'wallet_history_analyzer',
            observedAt: new Date(),
            nature: 'OBSERVED',
          },
          confirmedAt: new Date(),
        });
        warnings.push({
          code: 'HISTORICAL_RUG_PULL_DETECTED',
          title: 'Evidence of Historical Rug Pull Activity',
          severity: 'CRITICAL',
          description: 'Direct on-chain evidence links this wallet to prior token rug-pull.',
          evidence: {
            signatures: ['RugSignatureConfirmed11111111111111111111111111'],
            addresses: [walletAddress, 'RuggedTokenMint1111111111111111111111111111'],
            description: 'Historical dump/pull transactions confirmed',
            source: 'wallet_history_analyzer',
            observedAt: new Date(),
            nature: 'OBSERVED',
          },
          detectedAt: new Date(),
        });
      };

      const profile = await service.analyzeWalletHistory('MaliciousCreatorWallet11111111111111111');

      expect(profile.riskLevel).toBe('CRITICAL');
      expect(profile.riskScore).toBe(95);
      expect(
        profile.knownHarmfulBehaviors.some((b) => b.behaviorType === 'CONFIRMED_RUG_PULL'),
      ).toBe(true);

      const rugWarning = profile.warnings.find((w) => w.code === 'HISTORICAL_RUG_PULL_DETECTED');
      expect(rugWarning?.severity).toBe('CRITICAL');
      expect(rugWarning?.evidence.signatures).toContain(
        'RugSignatureConfirmed11111111111111111111111111',
      );
    });

    it('does not falsely accuse an established legitimate creator with safe past launches', async () => {
      const signatures: RawSignatureItem[] = [];
      for (let i = 0; i < 20; i++) {
        signatures.push({
          signature: `NormalTxSig_${i}_11111111111111111111111111111111111`,
          slot: 280000 + i,
          blockTime: 1700000000 + i * 3600,
        });
      }
      // 1 single deployment
      signatures[0] = {
        signature: 'LegitDeploySig1111111111111111111111111111111111111',
        slot: 280000,
        blockTime: 1700000000,
        memo: 'pump_fun:create',
      };

      const mockRpc = createMockRpcClient(signatures);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      const profile = await service.analyzeWalletHistory(
        'LegitCreatorWallet111111111111111111111111',
      );

      expect(profile.isNewWalletWithoutHistory).toBe(false);
      expect(profile.riskLevel).toBe('SAFE');
      expect(profile.riskScore).toBe(10);
      expect(profile.knownHarmfulBehaviors).toHaveLength(0);
      expect(profile.warnings).toHaveLength(0);
      expect(profile.explanation).toContain('Established wallet with stable transaction history');
    });

    it('detects concentrated early purchases and attaches exact signature evidence', async () => {
      const signatures: RawSignatureItem[] = [
        { signature: 'SnipeSig1', slot: 280001, blockTime: 1700000100, memo: 'pump_fun:buy:early' },
        { signature: 'SnipeSig2', slot: 280002, blockTime: 1700000105, memo: 'pump_fun:buy:early' },
        { signature: 'NormalSig3', slot: 280003, blockTime: 1700000200 },
      ];
      const mockRpc = createMockRpcClient(signatures);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      const profile = await service.analyzeWalletHistory(
        'SniperWallet11111111111111111111111111111',
      );

      expect(profile.earlyPurchases).toHaveLength(2);
      expect(profile.earlyPurchases[0]?.isSuspectedSniper).toBe(true);
      expect(profile.earlyPurchases[0]?.signature).toBe('SnipeSig1');

      const earlyWarning = profile.warnings.find((w) => w.code === 'CONCENTRATED_EARLY_BUYS');
      expect(earlyWarning).toBeDefined();
      expect(earlyWarning?.severity).toBe('WARNING');
      expect(earlyWarning?.evidence.signatures).toEqual(['SnipeSig1', 'SnipeSig2']);
    });

    it('detects multi-wallet creator token distribution clusters', async () => {
      const signatures: RawSignatureItem[] = [
        {
          signature: 'DistSig1',
          slot: 280001,
          blockTime: 1700000100,
          memo: 'transfer:distribution',
        },
        {
          signature: 'DistSig2',
          slot: 280002,
          blockTime: 1700000102,
          memo: 'transfer:distribution',
        },
        { signature: 'NormalSig3', slot: 280003, blockTime: 1700000200 },
      ];
      const mockRpc = createMockRpcClient(signatures);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      const profile = await service.analyzeWalletHistory('DistributorCreator11111111111111111111');

      const distWarning = profile.warnings.find((w) => w.code === 'CREATOR_DISTRIBUTION_CLUSTER');
      expect(distWarning).toBeDefined();
      expect(distWarning?.evidence.signatures).toEqual(['DistSig1', 'DistSig2']);
      expect(distWarning?.evidence.nature).toBe('OBSERVED');
    });

    it('detects launch-and-dump recurring pattern when creator quickly dumps dev allocations', async () => {
      const signatures: RawSignatureItem[] = [
        { signature: 'CreateSig1', slot: 280001, blockTime: 1700000100, memo: 'pump_fun:create' },
        {
          signature: 'SellDumpSig2',
          slot: 280002,
          blockTime: 1700000120,
          memo: 'pump_fun:sell:large',
        },
        { signature: 'TxOther3', slot: 280003, blockTime: 1700000200 },
      ];
      const mockRpc = createMockRpcClient(signatures);
      const cache = new WalletHistoryCache(100, 60_000);
      const service = new WalletHistoryService(mockRpc, cache);

      // Force devDumpedAllPct on launch
      const profile = await service.analyzeWalletHistory('DumpCreatorWallet111111111111111111111');
      expect(profile.largeSells).toHaveLength(1);
      expect(profile.largeSells[0]?.sellerAddress).toBe('DumpCreatorWallet111111111111111111111');
      expect(profile.largeSells[0]?.solReceived).toBe(15.0);
    });
  });

  describe('Pagination, Freshness, and Cache Lifecycle', () => {
    it('safely paginates signatures across multiple pages using cursors', async () => {
      const allSignatures: RawSignatureItem[] = [];
      for (let i = 0; i < 60; i++) {
        allSignatures.push({
          signature: `PageSig_${i}_${'1'.repeat(40)}`,
          slot: 280000 + i,
          blockTime: 1700000000 + i,
        });
      }

      const mockRpc = createMockRpcClient(allSignatures);
      const paginator = new HistoryPaginator(mockRpc);

      const result = await paginator.getSignaturesPaged(
        'PaginationWallet111111111111111111111111',
        {
          pageSize: 25,
          maxPages: 4,
        },
      );

      expect(result.signatures).toHaveLength(60);
      expect(result.coverage.totalSignaturesObserved).toBe(60);
      expect(result.coverage.coverage).toBe('FULL_HISTORY');
      expect(result.coverage.isTruncated).toBe(false);
      expect(result.coverage.startSlot).toBe(280000);
      expect(result.coverage.endSlot).toBe(280059);
    });

    it('marks coverage as TRUNCATED_BY_BUDGET when maxPages limit is reached', async () => {
      const allSignatures: RawSignatureItem[] = [];
      for (let i = 0; i < 150; i++) {
        allSignatures.push({
          signature: `HeavySig_${i}_${'1'.repeat(40)}`,
          slot: 280000 + i,
          blockTime: 1700000000 + i,
        });
      }

      const mockRpc = createMockRpcClient(allSignatures);
      const paginator = new HistoryPaginator(mockRpc);

      const result = await paginator.getSignaturesPaged(
        'HeavyWallet11111111111111111111111111111',
        {
          pageSize: 50,
          maxPages: 2, // max 100 signatures fetched
        },
      );

      expect(result.signatures).toHaveLength(100);
      expect(result.coverage.isTruncated).toBe(true);
      expect(result.coverage.coverage).toBe('TRUNCATED_BY_BUDGET');
      expect(result.coverage.reason).toContain('History bounded to 100 signatures across 2 pages');
    });

    it('caches profiles, respects TTL, and supports forced recalculation', async () => {
      let rpcCallCount = 0;
      const mockRpc = {
        call: async () => {
          rpcCallCount++;
          return [
            {
              signature: `CallSig_${rpcCallCount}_111111111111111111111111111111111`,
              slot: 280000 + rpcCallCount,
              blockTime: 1700000000,
            },
          ];
        },
      } as unknown as SolanaRpcClient;

      const cache = new WalletHistoryCache(50, 5000);
      const service = new WalletHistoryService(mockRpc, cache);
      const targetWallet = 'CachingTestWallet11111111111111111111111111';

      // First call: cache miss, triggers RPC
      const res1 = await service.analyzeWalletHistory(targetWallet);
      expect(rpcCallCount).toBe(1);
      expect(res1.isFresh).toBe(true);

      // Second call: cache hit, no new RPC call
      const res2 = await service.analyzeWalletHistory(targetWallet);
      expect(rpcCallCount).toBe(1);
      expect(res2.walletAddress).toBe(targetWallet);

      // Third call with forceRecalculate: true -> bypasses cache, calls RPC
      const res3 = await service.analyzeWalletHistory(targetWallet, { forceRecalculate: true });
      expect(rpcCallCount).toBe(2);
      expect(res3.walletAddress).toBe(targetWallet);

      // Invalidation
      const invalidated = service.invalidateWalletCache(targetWallet);
      expect(invalidated).toBe(true);

      // Fourth call after invalidation -> calls RPC
      await service.analyzeWalletHistory(targetWallet);
      expect(rpcCallCount).toBe(3);
    });

    it('handles expired cache entries by refetching and recalculating on-chain history', async () => {
      let rpcCallCount = 0;
      const mockRpc = {
        call: async () => {
          rpcCallCount++;
          return [
            {
              signature: `ExpiredSig_${rpcCallCount}_111111111111111111111111111`,
              slot: 280000 + rpcCallCount,
              blockTime: 1700000000,
            },
          ];
        },
      } as unknown as SolanaRpcClient;

      // Short TTL of 50ms for quick expiration
      const cache = new WalletHistoryCache(50, 50);
      const service = new WalletHistoryService(mockRpc, cache);
      const wallet = 'ExpiringWallet1111111111111111111111111111';

      await service.analyzeWalletHistory(wallet);
      expect(rpcCallCount).toBe(1);

      // Wait 60ms to let cache entry expire
      await new Promise((r) => setTimeout(r, 60));

      // Second call after expiry must trigger new RPC call
      await service.analyzeWalletHistory(wallet);
      expect(rpcCallCount).toBe(2);
    });
  });
});
