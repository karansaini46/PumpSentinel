import { describe, it, expect } from 'vitest';
import bs58 from 'bs58';
import { BorshReader } from '../../src/modules/ingestion/decoder/borsh-reader.js';

describe('BorshReader', () => {
  it('reads primitive types correctly', () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt8(42, 0); // u8
    buf.writeUInt8(1, 1); // bool true
    buf.writeUInt16LE(1234, 2); // u16
    buf.writeUInt32LE(56789, 4); // u32
    buf.writeBigUInt64LE(1000000000n, 8); // u64

    const reader = new BorshReader(buf);
    expect(reader.readU8()).toBe(42);
    expect(reader.readBool()).toBe(true);
    expect(reader.readU16()).toBe(1234);
    expect(reader.readU32()).toBe(56789);
    expect(reader.readU64()).toBe(1000000000n);
    expect(reader.remaining).toBe(0);
  });

  it('reads length-prefixed UTF-8 strings', () => {
    const text = 'PumpSentinel';
    const textBytes = Buffer.from(text, 'utf8');
    const buf = Buffer.alloc(4 + textBytes.length);
    buf.writeUInt32LE(textBytes.length, 0);
    textBytes.copy(buf, 4);

    const reader = new BorshReader(buf);
    expect(reader.readString()).toBe('PumpSentinel');
  });

  it('reads 32-byte public key and encodes to base58', () => {
    const keyBytes = Buffer.alloc(32, 7); // 32 bytes filled with 7
    const expectedBase58 = bs58.encode(keyBytes);

    const reader = new BorshReader(keyBytes);
    expect(reader.readPubkey()).toBe(expectedBase58);
  });

  it('throws on buffer underrun', () => {
    const buf = Buffer.alloc(2);
    const reader = new BorshReader(buf);
    expect(() => reader.readU32()).toThrow(/Buffer underrun/);
  });
});
