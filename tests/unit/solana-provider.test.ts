import { describe, it, expect } from 'vitest';
import bs58 from 'bs58';
import { HeliusSolanaProvider } from '../../src/modules/ingestion/providers/helius-provider.js';
import { PollingSolanaProvider } from '../../src/modules/ingestion/providers/polling-provider.js';
import { MockSolanaProvider } from '../../src/modules/ingestion/providers/mock-provider.js';
import { IngestionStreamService } from '../../src/modules/ingestion/stream.service.js';
import { DISCRIMINATORS } from '../../src/modules/ingestion/decoder/pump-fun-layout.js';

function encodeString(str: string): Buffer {
  const bytes = Buffer.from(str, 'utf8');
  const buf = Buffer.alloc(4 + bytes.length);
  buf.writeUInt32LE(bytes.length, 0);
  bytes.copy(buf, 4);
  return buf;
}

describe('Solana Data Access Providers', () => {
  const mintBytes = Buffer.alloc(32, 1);
  const bondingCurveBytes = Buffer.alloc(32, 2);
  const userBytes = Buffer.alloc(32, 3);

  it('HeliusSolanaProvider processes logs, prevents duplicates, and emits events', async () => {
    const provider = new HeliusSolanaProvider({
      httpUrl: 'https://mainnet.helius-rpc.com',
      wsUrl: 'wss://mainnet.helius-rpc.com',
      apiKey: 'test-api-key',
    });

    const createPayload = Buffer.concat([
      DISCRIMINATORS.CREATE_EVENT,
      encodeString('Test Token'),
      encodeString('TEST'),
      encodeString('https://ipfs.io/meta'),
      mintBytes,
      bondingCurveBytes,
      userBytes,
    ]);

    const logs = [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      `Program data: ${createPayload.toString('base64')}`,
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
    ];

    const emittedEvents: Array<{ mint: string; symbol: string }> = [];
    provider.onTokenCreated((ev) => {
      emittedEvents.push({ mint: ev.mint, symbol: ev.symbol });
    });

    // Simulate logs notification
    // @ts-expect-error accessing private method for test
    await provider.handleLogsNotification(
      { signature: 'sig_launch_1', err: null, logs },
      250000000,
    );

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.symbol).toBe('TEST');
    expect(emittedEvents[0]?.mint).toBe(bs58.encode(mintBytes));

    // Send identical signature again: should be deduplicated
    // @ts-expect-error accessing private method for test
    await provider.handleLogsNotification(
      { signature: 'sig_launch_1', err: null, logs },
      250000000,
    );
    expect(emittedEvents).toHaveLength(1); // No duplicate emitted!

    const health = provider.getHealth();
    expect(health.duplicatesPrevented).toBe(1);
    expect(health.eventsProcessed).toBe(1);
    expect(health.sanitizedEndpoint).toContain('[REDACTED]');
  });

  it('PollingSolanaProvider parses signatures and transactions with deduplication', async () => {
    const provider = new PollingSolanaProvider({
      httpUrl: 'https://api.mainnet-beta.solana.com',
      pollingIntervalMs: 5000,
      batchSize: 5,
    });

    const createPayload = Buffer.concat([
      DISCRIMINATORS.CREATE_EVENT,
      encodeString('Polled Coin'),
      encodeString('POLL'),
      encodeString('https://poll.io/meta'),
      mintBytes,
      bondingCurveBytes,
      userBytes,
    ]);

    // Mock RPC calls
    // @ts-expect-error accessing private rpcClient for test
    provider.rpcClient.call = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'getSignaturesForAddress') {
        return [{ signature: 'poll_sig_1', slot: 200, err: null, blockTime: 1700000000 }];
      }
      if (method === 'getTransaction') {
        return {
          slot: 200,
          blockTime: 1700000000,
          meta: {
            err: null,
            logMessages: [`Program data: ${createPayload.toString('base64')}`],
          },
        };
      }
      return null;
    });

    const created: string[] = [];
    provider.onTokenCreated((ev) => {
      created.push(ev.symbol);
    });

    const count = await provider.pollOnce();
    expect(count).toBe(1);
    expect(created).toContain('POLL');

    // Second poll with same signature should not re-process
    const count2 = await provider.pollOnce();
    expect(count2).toBe(0);
  });

  it('MockSolanaProvider integrates cleanly with IngestionStreamService and allows runtime swapping', async () => {
    const mock = new MockSolanaProvider();
    const service = new IngestionStreamService(mock);

    const received: string[] = [];
    service.onEvent((ev) => {
      if (ev.type === 'TOKEN_CREATED') {
        received.push(ev.symbol);
      }
    });

    mock.emitMockCreate({ symbol: 'MOCK1' });
    expect(received).toContain('MOCK1');

    // Swap provider to another mock instance
    const mock2 = new MockSolanaProvider();
    service.setProvider(mock2);

    mock2.emitMockCreate({ symbol: 'MOCK2' });
    expect(received).toContain('MOCK2');
  });
});
