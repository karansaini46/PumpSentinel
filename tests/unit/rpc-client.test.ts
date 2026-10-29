import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { SolanaRpcClient } from '../../src/modules/ingestion/transport/rpc-client.js';

describe('SolanaRpcClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts API key from sanitizedUrl', () => {
    const client = new SolanaRpcClient({
      httpUrl: 'https://mainnet.helius-rpc.com',
      apiKey: 'secret-helius-key-12345',
    });

    expect(client.sanitizedUrl).toContain('[REDACTED]');
    expect(client.sanitizedUrl).not.toContain('secret-helius-key-12345');
  });

  it('successfully parses valid JSON-RPC 2.0 response and validates schema', async () => {
    const client = new SolanaRpcClient({
      httpUrl: 'https://api.mainnet-beta.solana.com',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        result: 250100200,
        id: 1,
      }),
    });

    const slot = await client.call('getSlot', [], z.number());
    expect(slot).toBe(250100200);
    expect(client.getMetrics().successfulRequests).toBe(1);
  });

  it('handles JSON-RPC error responses with descriptive message', async () => {
    const client = new SolanaRpcClient({
      httpUrl: 'https://api.mainnet-beta.solana.com',
      maxRetries: 0,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        error: { code: -32602, message: 'Invalid params: expected address' },
        id: 1,
      }),
    });

    await expect(client.call('getAccountInfo', [])).rejects.toThrow(
      /RPC Error -32602: Invalid params/,
    );
  });

  it('retries on HTTP 429 rate limit before failing', async () => {
    const client = new SolanaRpcClient({
      httpUrl: 'https://api.mainnet-beta.solana.com',
      maxRetries: 1,
    });

    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '0' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', result: 99999, id: 2 }),
      };
    });

    const result = await client.call('getSlot', [], z.number());
    expect(result).toBe(99999);
    expect(client.getMetrics().retriedRequests).toBe(1);
  });
});
