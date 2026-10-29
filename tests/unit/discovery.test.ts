import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryService } from '../../src/modules/discovery/discovery.service.js';
import { AddressValidator } from '../../src/modules/discovery/address-validator.js';
import { ReplayService } from '../../src/modules/discovery/replay.service.js';
import { cursorRepository } from '../../src/modules/persistence/cursor.repository.js';
import { tokenRepository } from '../../src/modules/persistence/token.repository.js';
import { metadataService } from '../../src/modules/metadata/metadata.service.js';
import type { IngestionTokenCreatedEvent } from '../../src/modules/ingestion/ingestion.types.js';

describe('Token Discovery Service', () => {
  let discovery: DiscoveryService;

  beforeEach(() => {
    vi.restoreAllMocks();
    discovery = new DiscoveryService(100);
    // Mock database repository methods to avoid external dependencies in unit tests
    vi.spyOn(tokenRepository, 'upsertToken').mockResolvedValue({} as never);
    vi.spyOn(tokenRepository, 'updateLifecycle').mockResolvedValue({} as never);
    vi.spyOn(cursorRepository, 'saveCursor').mockResolvedValue();
  });

  const validLaunchEvent: IngestionTokenCreatedEvent = {
    type: 'TOKEN_CREATED',
    mint: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    creator: 'So11111111111111111111111111111111111111112',
    name: 'Verified Coin',
    symbol: 'VCOIN',
    uri: 'https://arweave.net/meta.json',
    bondingCurve: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
    signature:
      '5wvnZuL1v8M1H5H9yM6S8K9Q2P4R7T3V1W8Y5Z2A4B6C8D0E2F4G6H8J0K2L4M6N8P0R2S4T6U8V0W2X4Y6Z8A0B',
    slot: 250100500,
    timestamp: Date.now() - 250,
    receivedAt: new Date(),
    source: 'solana_rpc_ws',
    initialSolLiquidity: 30.0,
  };

  it('successfully discovers an on-chain token and progresses through lifecycle stages', async () => {
    vi.spyOn(metadataService, 'resolveMetadata').mockResolvedValue({
      mint: validLaunchEvent.mint,
      name: validLaunchEvent.name,
      symbol: validLaunchEvent.symbol,
      hasValidUri: true,
      socials: { twitter: 'https://x.com/vcoin' },
      fetchedAt: new Date(),
    });

    const onChainTokens: string[] = [];
    const eligibleTokens: string[] = [];

    discovery.onTokenDiscoveredOnChain((token) => {
      onChainTokens.push(token.mint);
    });

    discovery.onTokenEligibleForRisk((token) => {
      eligibleTokens.push(token.mint);
    });

    const token = await discovery.processTokenCreation(validLaunchEvent);

    expect(token).not.toBeNull();
    expect(token?.lifecycleState).toBe('ELIGIBLE_FOR_RISK_ANALYSIS');
    expect(token?.metadataStatus).toBe('RESOLVED');
    expect(token?.discoveryLatencyMs).toBeGreaterThanOrEqual(0);
    expect(token?.isSynthetic).toBe(false);

    expect(onChainTokens).toContain(validLaunchEvent.mint);
    expect(eligibleTokens).toContain(validLaunchEvent.mint);
    expect(discovery.getStats().totalDiscovered).toBe(1);
    expect(discovery.getStats().eligibleCount).toBe(1);
  });

  it('rejects duplicate events with the same mint address', async () => {
    const first = await discovery.processTokenCreation(validLaunchEvent);
    expect(first).not.toBeNull();

    // Send duplicate event
    const second = await discovery.processTokenCreation(validLaunchEvent);
    expect(second).toBeNull();
    expect(discovery.getStats().duplicateCount).toBe(1);
    expect(discovery.getStats().totalDiscovered).toBe(1);
  });

  it('rejects malformed transactions with invalid addresses or corrupted payloads', async () => {
    // Malformed: mint is not a valid 32-byte base58 address
    const malformedMintEvent: IngestionTokenCreatedEvent = {
      ...validLaunchEvent,
      mint: 'invalid_short_mint',
    };

    const res1 = await discovery.processTokenCreation(malformedMintEvent);
    expect(res1).toBeNull();

    // Malformed: creator wallet is not base58
    const malformedCreatorEvent: IngestionTokenCreatedEvent = {
      ...validLaunchEvent,
      creator: 'not-base-58-creator-wallet!!!',
    };

    const res2 = await discovery.processTokenCreation(malformedCreatorEvent);
    expect(res2).toBeNull();

    // Malformed: null byte in token name
    const nullByteEvent: IngestionTokenCreatedEvent = {
      ...validLaunchEvent,
      name: 'Bad\0Name',
    };

    const res3 = await discovery.processTokenCreation(nullByteEvent);
    expect(res3).toBeNull();

    expect(discovery.getStats().processingFailuresCount).toBe(3);
  });

  it('handles missing or failed metadata gracefully without crashing', async () => {
    const missingMetadataEvent: IngestionTokenCreatedEvent = {
      ...validLaunchEvent,
      mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      uri: '', // Missing URI
    };

    const token = await discovery.processTokenCreation(missingMetadataEvent);
    expect(token).not.toBeNull();
    expect(token?.metadataStatus).toBe('MISSING');
    // Still transitions to eligible for risk analysis, which will assess missing metadata penalty
    expect(token?.lifecycleState).toBe('ELIGIBLE_FOR_RISK_ANALYSIS');
  });

  it('resumes cursor watermark after application restarts', async () => {
    vi.spyOn(cursorRepository, 'getCursor').mockResolvedValue({
      id: 'pump_fun_cursor',
      lastSlot: 249000111,
      lastSignature: 'sig_restored_cursor',
      lastProcessedAt: new Date(),
    });

    await discovery.init();
    const cursor = discovery.getCursor();
    expect(cursor.lastSlot).toBe(249000111);
    expect(cursor.lastSignature).toBe('sig_restored_cursor');
  });

  it('labels synthetic tokens explicitly in development replay mode', async () => {
    const replay = new ReplayService();
    const replayedTokens: Array<{ isSynthetic: boolean; source: string }> = [];

    discovery.onTokenDiscoveredOnChain((token) => {
      replayedTokens.push(token);
    });

    await replay.replay({
      onEvent: async (ev) => {
        await discovery.processTokenCreation(ev);
      },
    });

    expect(replayedTokens.length).toBeGreaterThan(0);
    for (const token of replayedTokens) {
      // Must be explicitly labeled as synthetic
      expect(token.isSynthetic).toBe(true);
      expect(token.source).toBe('synthetic_replay');
    }
    expect(discovery.getStats().syntheticCount).toBe(replayedTokens.length);
  });

  it('handles out-of-order events without regressing cursor watermark', async () => {
    const higherSlotEvent: IngestionTokenCreatedEvent = {
      ...validLaunchEvent,
      mint: 'SyntH44444444444444444444444444444444444444',
      slot: 300000000,
      signature: 'sig_slot_300',
    };

    const lowerSlotEvent: IngestionTokenCreatedEvent = {
      ...validLaunchEvent,
      mint: 'SyntH55555555555555555555555555555555555555',
      slot: 290000000, // Older slot arriving after higher slot
      signature: 'sig_slot_290',
    };

    // Process higher slot first
    await discovery.processTokenCreation(higherSlotEvent);
    expect(discovery.getCursor().lastSlot).toBe(300000000);
    expect(discovery.getCursor().lastSignature).toBe('sig_slot_300');

    // Process out-of-order lower slot
    const lowerToken = await discovery.processTokenCreation(lowerSlotEvent);
    expect(lowerToken).not.toBeNull();
    // Watermark must not regress
    expect(discovery.getCursor().lastSlot).toBe(300000000);
    expect(discovery.getCursor().lastSignature).toBe('sig_slot_300');
  });

  it('measures discovery latency and failure stats accurately', async () => {
    const onChainTime = Date.now() - 450; // 450ms ago
    const receivedTime = new Date();

    const timedEvent: IngestionTokenCreatedEvent = {
      ...validLaunchEvent,
      mint: 'SyntH66666666666666666666666666666666666666',
      timestamp: onChainTime,
      receivedAt: receivedTime,
    };

    const token = await discovery.processTokenCreation(timedEvent);
    expect(token).not.toBeNull();
    expect(token?.discoveryLatencyMs).toBeGreaterThanOrEqual(400);

    const stats = discovery.getStats();
    expect(stats.averageDiscoveryLatencyMs).toBeGreaterThanOrEqual(400);
  });

  it('handles metadata provider failure without fabricating token data', async () => {
    vi.spyOn(metadataService, 'resolveMetadata').mockRejectedValue(
      new Error('Metadata provider 503 Service Unavailable'),
    );

    const token = await discovery.processTokenCreation({
      ...validLaunchEvent,
      mint: 'SyntH77777777777777777777777777777777777777',
    });

    expect(token).not.toBeNull();
    // Never fabricates data: metadataStatus must be marked FAILED
    expect(token?.metadataStatus).toBe('FAILED');
    expect(token?.lifecycleState).toBe('ELIGIBLE_FOR_RISK_ANALYSIS');
  });

  it('applies discovery filter criteria correctly', async () => {
    discovery.setFilters({ minInitialSol: 50.0, excludedSymbols: ['SPAM'] });

    // Should be filtered due to low liquidity (30 < 50)
    const lowLiquidityToken = await discovery.processTokenCreation({
      ...validLaunchEvent,
      mint: 'SyntH11111111111111111111111111111111111111',
      initialSolLiquidity: 30.0,
    });
    expect(lowLiquidityToken).toBeNull();

    // Should be filtered due to blacklisted symbol
    const spamToken = await discovery.processTokenCreation({
      ...validLaunchEvent,
      mint: 'SyntH22222222222222222222222222222222222222',
      symbol: 'SPAM',
      initialSolLiquidity: 100.0,
    });
    expect(spamToken).toBeNull();

    // Passing token
    const validFilteredToken = await discovery.processTokenCreation({
      ...validLaunchEvent,
      mint: 'SyntH33333333333333333333333333333333333333',
      symbol: 'GOOD',
      initialSolLiquidity: 60.0,
    });
    expect(validFilteredToken).not.toBeNull();
  });

  it('validates public key formatting using AddressValidator', () => {
    expect(
      AddressValidator.isValidSolanaAddress('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
    ).toBe(true);
    expect(
      AddressValidator.isValidSolanaAddress('So11111111111111111111111111111111111111112'),
    ).toBe(true);
    expect(AddressValidator.isValidSolanaAddress('invalid_length')).toBe(false);
    expect(AddressValidator.isValidSolanaAddress('')).toBe(false);
    expect(AddressValidator.isValidSolanaAddress(null)).toBe(false);
  });
});
