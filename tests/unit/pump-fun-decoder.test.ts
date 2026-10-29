import { describe, it, expect } from 'vitest';
import bs58 from 'bs58';
import {
  DISCRIMINATORS,
  decodeCreateEvent,
  decodeTradeEvent,
} from '../../src/modules/ingestion/decoder/pump-fun-layout.js';
import { PumpFunDecoder } from '../../src/modules/ingestion/decoder/pump-fun-decoder.js';

function encodeString(str: string): Buffer {
  const bytes = Buffer.from(str, 'utf8');
  const buf = Buffer.alloc(4 + bytes.length);
  buf.writeUInt32LE(bytes.length, 0);
  bytes.copy(buf, 4);
  return buf;
}

describe('Pump.fun Decoder', () => {
  const mintBytes = Buffer.alloc(32, 1);
  const bondingCurveBytes = Buffer.alloc(32, 2);
  const userBytes = Buffer.alloc(32, 3);

  it('correctly decodes CreateEvent from binary buffer', () => {
    const payload = Buffer.concat([
      DISCRIMINATORS.CREATE_EVENT,
      encodeString('Sentinel Token'),
      encodeString('SENT'),
      encodeString('https://ipfs.io/ipfs/QmExample'),
      mintBytes,
      bondingCurveBytes,
      userBytes,
    ]);

    const decoded = decodeCreateEvent(payload);
    expect(decoded.name).toBe('Sentinel Token');
    expect(decoded.symbol).toBe('SENT');
    expect(decoded.uri).toBe('https://ipfs.io/ipfs/QmExample');
    expect(decoded.mint).toBe(bs58.encode(mintBytes));
    expect(decoded.bondingCurve).toBe(bs58.encode(bondingCurveBytes));
    expect(decoded.user).toBe(bs58.encode(userBytes));
  });

  it('correctly decodes TradeEvent with reserves', () => {
    const tradeData = Buffer.alloc(8 + 8 + 1 + 32 + 8 + 8 + 8);
    tradeData.writeBigUInt64LE(1500000000n, 0); // solAmount (1.5 SOL)
    tradeData.writeBigUInt64LE(50000000000n, 8); // tokenAmount
    tradeData.writeUInt8(1, 16); // isBuy = true
    userBytes.copy(tradeData, 17); // user pubkey
    tradeData.writeBigInt64LE(1700000000n, 49); // timestamp
    tradeData.writeBigUInt64LE(30000000000n, 57); // virtualSolReserves
    tradeData.writeBigUInt64LE(1000000000000n, 65); // virtualTokenReserves

    const payload = Buffer.concat([DISCRIMINATORS.TRADE_EVENT, mintBytes, tradeData]);

    const decoded = decodeTradeEvent(payload);
    expect(decoded.mint).toBe(bs58.encode(mintBytes));
    expect(decoded.solAmount).toBe(1500000000n);
    expect(decoded.tokenAmount).toBe(50000000000n);
    expect(decoded.isBuy).toBe(true);
    expect(decoded.user).toBe(bs58.encode(userBytes));
    expect(decoded.timestamp).toBe(1700000000n);
  });

  it('extracts and parses Anchor Program data logs', () => {
    const createPayload = Buffer.concat([
      DISCRIMINATORS.CREATE_EVENT,
      encodeString('Moon Coin'),
      encodeString('MOON'),
      encodeString('https://moon.example/meta.json'),
      mintBytes,
      bondingCurveBytes,
      userBytes,
    ]);

    const sampleLogs = [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Create',
      `Program data: ${createPayload.toString('base64')}`,
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
    ];

    const decoder = new PumpFunDecoder();
    const events = decoder.parseLogs(sampleLogs);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('CREATE');
    if (events[0]?.type === 'CREATE') {
      expect(events[0].event.symbol).toBe('MOON');
      expect(events[0].event.name).toBe('Moon Coin');
    }
  });

  it('ignores unrelated or corrupted logs gracefully', () => {
    const decoder = new PumpFunDecoder();
    const logs = [
      'Program 11111111111111111111111111111111 invoke [1]',
      'Program log: some message',
      'Program data: invalid-base64???',
      'Program data: YWJj', // too short (<8 bytes)
    ];

    const events = decoder.parseLogs(logs);
    expect(events).toHaveLength(0);
  });
});
