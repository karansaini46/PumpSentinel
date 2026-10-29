import bs58 from 'bs58';

export class BorshReader {
  private buffer: Buffer;
  private offset = 0;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  public get remaining(): number {
    return this.buffer.length - this.offset;
  }

  public get currentOffset(): number {
    return this.offset;
  }

  public readU8(): number {
    this.assertRemaining(1);
    const val = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return val;
  }

  public readBool(): boolean {
    return this.readU8() === 1;
  }

  public readU16(): number {
    this.assertRemaining(2);
    const val = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return val;
  }

  public readU32(): number {
    this.assertRemaining(4);
    const val = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return val;
  }

  public readU64(): bigint {
    this.assertRemaining(8);
    const val = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return val;
  }

  public readI64(): bigint {
    this.assertRemaining(8);
    const val = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return val;
  }

  public readBytes(length: number): Buffer {
    this.assertRemaining(length);
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  public readString(): string {
    const len = this.readU32();
    if (len === 0) return '';
    const bytes = this.readBytes(len);
    return bytes.toString('utf8');
  }

  public readPubkey(): string {
    const bytes = this.readBytes(32);
    return bs58.encode(bytes);
  }

  private assertRemaining(length: number): void {
    if (this.remaining < length) {
      throw new Error(
        `[BorshReader] Buffer underrun: requested ${length} bytes but only ${this.remaining} available at offset ${this.offset}`,
      );
    }
  }
}
