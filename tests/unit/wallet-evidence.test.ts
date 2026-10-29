import { describe, it, expect } from 'vitest';
import {
  WalletEvidenceEngine,
  type RawWalletEvidenceItem,
} from '../../src/modules/analysis/wallet-evidence/wallet-evidence-engine.js';
import type {
  DismissedWalletLink,
  WalletConnectionEvidence,
} from '../../src/modules/analysis/analysis.types.js';

describe('WalletEvidenceEngine', () => {
  const engine = new WalletEvidenceEngine();
  const targetWallet = 'TargetDevWallet11111111111111111111111111111';

  // -------------------------------------------------------------------------
  // Core Negative Invariant:
  // "Do not claim that wallets are connected merely because they bought the same token."
  // -------------------------------------------------------------------------
  it('CRITICAL: strictly rejects same-token purchases as connection evidence', () => {
    const buyerA = 'BuyerWalletA1111111111111111111111111111111';
    const buyerB = 'BuyerWalletB2222222222222222222222222222222';

    const candidates: RawWalletEvidenceItem[] = [
      {
        walletA: buyerA,
        walletB: buyerB,
        type: 'SAME_TOKEN_TRADED',
        description: 'Both wallets bought VCOIN within 30 seconds',
      },
      {
        walletA: targetWallet,
        walletB: buyerA,
        type: 'SAME_POOL_INTERACTION',
        description: 'Both interacted with the same pump.fun curve',
      },
    ];

    const result = engine.evaluateLinks(targetWallet, candidates);

    // Absolutely no connected wallets should be declared
    expect(result.linkedWallets.value).toEqual([]);
    expect(result.connectedWalletCount.value).toBe(0);
    expect(result.hasSybilCluster.value).toBe(false);

    // Must be explicitly documented as dismissed non-evidence
    const dismissed = result.dismissedNonEvidenceLinks.value as DismissedWalletLink[];
    expect(Array.isArray(dismissed)).toBe(true);
    expect(dismissed.length).toBe(2);
    expect(dismissed[0]?.claimedRelation).toBe('SAME_TOKEN_TRADED');
    expect(dismissed[0]?.reason).toContain(
      'does NOT constitute cryptographic or on-chain evidence',
    );
  });

  // -------------------------------------------------------------------------
  // Positive Evidence Links
  // -------------------------------------------------------------------------
  it('connects wallets funded by the same parent wallet (COMMON_FUNDER)', () => {
    const parentFunder = 'CommonParentFunder11111111111111111111111111';
    const puppetWallet = 'PuppetWallet11111111111111111111111111111111';

    const candidates: RawWalletEvidenceItem[] = [
      {
        walletA: targetWallet,
        walletB: puppetWallet,
        type: 'COMMON_FUNDER',
        funderAddress: parentFunder,
        signature:
          '5wvnZuL1v8M1H5H9yM6S8K9Q2P4R7T3V1W8Y5Z2A4B6C8D0E2F4G6H8J0K2L4M6N8P0R2S4T6U8V0W2X4Y6Z8A0B',
      },
    ];

    const result = engine.evaluateLinks(targetWallet, candidates);

    expect(result.connectedWalletCount.value).toBe(1);
    const links = result.linkedWallets.value as WalletConnectionEvidence[];
    expect(links.length).toBe(1);
    expect(links[0]?.evidenceType).toBe('COMMON_FUNDER');
    expect(links[0]?.funderAddress).toBe(parentFunder);
    expect(links[0]?.confidence).toBe('HIGH');
  });

  it('connects wallets with direct SOL or asset transfers (DIRECT_TRANSFER)', () => {
    const accompliceWallet = 'AccompliceWallet1111111111111111111111111111';

    const candidates: RawWalletEvidenceItem[] = [
      {
        walletA: targetWallet,
        walletB: accompliceWallet,
        type: 'DIRECT_TRANSFER',
        amountSol: 15.0,
        signature: 'sig_direct_transfer_123',
      },
    ];

    const result = engine.evaluateLinks(targetWallet, candidates);

    expect(result.connectedWalletCount.value).toBe(1);
    const links = result.linkedWallets.value as WalletConnectionEvidence[];
    expect(links[0]?.evidenceType).toBe('DIRECT_TRANSFER');
    expect(links[0]?.transferAmountSol).toBe(15.0);
    expect(links[0]?.confidence).toBe('HIGH');
  });

  it('connects wallets sharing transaction fee payers (SHARED_FEE_PAYER)', () => {
    const sniperWallet = 'SniperWallet1111111111111111111111111111111';

    const candidates: RawWalletEvidenceItem[] = [
      {
        walletA: targetWallet,
        walletB: sniperWallet,
        type: 'SHARED_FEE_PAYER',
        signature: 'sig_shared_fee_123',
      },
    ];

    const result = engine.evaluateLinks(targetWallet, candidates);
    expect(result.connectedWalletCount.value).toBe(1);
    const links = result.linkedWallets.value as WalletConnectionEvidence[];
    expect(links[0]?.evidenceType).toBe('SHARED_FEE_PAYER');
  });

  it('detects a sybil cluster when 3 or more wallets are linked by verified evidence', () => {
    const parentFunder = 'SybilBossFunder11111111111111111111111111111';

    const candidates: RawWalletEvidenceItem[] = [
      {
        walletA: targetWallet,
        walletB: 'SybilPuppet111111111111111111111111111111111',
        type: 'COMMON_FUNDER',
        funderAddress: parentFunder,
      },
      {
        walletA: targetWallet,
        walletB: 'SybilPuppet222222222222222222222222222222222',
        type: 'COMMON_FUNDER',
        funderAddress: parentFunder,
      },
      {
        walletA: targetWallet,
        walletB: 'SybilPuppet333333333333333333333333333333333',
        type: 'DIRECT_TRANSFER',
        amountSol: 5.0,
      },
    ];

    const result = engine.evaluateLinks(targetWallet, candidates);

    expect(result.connectedWalletCount.value).toBe(3);
    expect(result.hasSybilCluster.value).toBe(true);
  });
});
