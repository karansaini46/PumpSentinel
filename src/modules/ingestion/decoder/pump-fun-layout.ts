import { BorshReader } from './borsh-reader.js';

export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Anchor 8-byte discriminators derived from sha256("event:<EventName>")[..8]
export const DISCRIMINATORS = {
  CREATE_EVENT: Buffer.from('1b72a94ddeeb6376', 'hex'),
  TRADE_EVENT: Buffer.from('bddb7fd34ee661ee', 'hex'),
  CREATE_IX: Buffer.from('181ec828051c0777', 'hex'),
  BUY_IX: Buffer.from('66063d1201daebea', 'hex'),
  SELL_IX: Buffer.from('33e685a4017f83ad', 'hex'),
} as const;

export interface DecodedCreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  user: string;
}

export interface DecodedTradeEvent {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp?: bigint;
  virtualSolReserves?: bigint;
  virtualTokenReserves?: bigint;
  realSolReserves?: bigint;
  realTokenReserves?: bigint;
}

export function matchesDiscriminator(data: Buffer, expected: Buffer): boolean {
  if (data.length < expected.length) return false;
  return data.subarray(0, expected.length).equals(expected);
}

export function decodeCreateEvent(payload: Buffer): DecodedCreateEvent {
  // Strip 8-byte Anchor discriminator if present
  const data = matchesDiscriminator(payload, DISCRIMINATORS.CREATE_EVENT)
    ? payload.subarray(8)
    : payload;

  const reader = new BorshReader(data);
  const name = reader.readString();
  const symbol = reader.readString();
  const uri = reader.readString();
  const mint = reader.readPubkey();
  const bondingCurve = reader.readPubkey();
  const user = reader.readPubkey();

  return {
    name,
    symbol,
    uri,
    mint,
    bondingCurve,
    user,
  };
}

export function decodeTradeEvent(payload: Buffer): DecodedTradeEvent {
  // Strip 8-byte Anchor discriminator if present
  const data = matchesDiscriminator(payload, DISCRIMINATORS.TRADE_EVENT)
    ? payload.subarray(8)
    : payload;

  const reader = new BorshReader(data);
  const mint = reader.readPubkey();
  const solAmount = reader.readU64();
  const tokenAmount = reader.readU64();
  const isBuy = reader.readBool();
  const user = reader.readPubkey();

  const result: DecodedTradeEvent = {
    mint,
    solAmount,
    tokenAmount,
    isBuy,
    user,
  };

  // Optional auxiliary fields appended in modern pump.fun versions
  if (reader.remaining >= 8) {
    result.timestamp = reader.readI64();
  }
  if (reader.remaining >= 8) {
    result.virtualSolReserves = reader.readU64();
  }
  if (reader.remaining >= 8) {
    result.virtualTokenReserves = reader.readU64();
  }
  if (reader.remaining >= 8) {
    result.realSolReserves = reader.readU64();
  }
  if (reader.remaining >= 8) {
    result.realTokenReserves = reader.readU64();
  }

  return result;
}
