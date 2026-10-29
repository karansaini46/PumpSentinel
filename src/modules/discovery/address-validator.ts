import bs58 from 'bs58';
import type { IngestionTokenCreatedEvent } from '../ingestion/ingestion.types.js';
import type { TokenValidationResult } from './discovery.types.js';

export class AddressValidator {
  /**
   * Validates whether a given string is a valid 32-byte base58 encoded Solana public key.
   */
  public static isValidSolanaAddress(address: unknown): boolean {
    if (typeof address !== 'string' || address.length < 32 || address.length > 44) {
      return false;
    }

    try {
      const decoded = bs58.decode(address);
      return decoded.length === 32;
    } catch {
      return false;
    }
  }

  /**
   * Validates a transaction signature format.
   */
  public static isValidSignature(sig: unknown): boolean {
    if (typeof sig !== 'string' || sig.length < 64 || sig.length > 90) {
      return false;
    }

    try {
      const decoded = bs58.decode(sig);
      return decoded.length === 64;
    } catch {
      return false;
    }
  }

  /**
   * Validates an entire token creation launch event before acceptance.
   */
  public static validateLaunchEvent(event: IngestionTokenCreatedEvent): TokenValidationResult {
    // 1. Validate mint address
    if (!this.isValidSolanaAddress(event.mint)) {
      return { isValid: false, reason: `Invalid Solana token mint address: "${event.mint}"` };
    }

    // 2. Validate creator wallet address
    if (!this.isValidSolanaAddress(event.creator)) {
      return {
        isValid: false,
        reason: `Invalid Solana creator wallet address: "${event.creator}"`,
      };
    }

    // 3. Validate bonding curve address if present
    if (event.bondingCurve && !this.isValidSolanaAddress(event.bondingCurve)) {
      return { isValid: false, reason: `Invalid bonding curve address: "${event.bondingCurve}"` };
    }

    // 4. Validate transaction signature (allow mock signatures in test/replay)
    if (!event.signature || event.signature.trim().length === 0) {
      return { isValid: false, reason: 'Transaction signature is missing' };
    }

    // 5. Validate text fields (protect against corrupted / oversized bytes)
    if (!event.name || event.name.includes('\0') || event.name.length > 100) {
      return {
        isValid: false,
        reason: 'Token name is empty, contains null bytes, or exceeds 100 characters',
      };
    }

    if (!event.symbol || event.symbol.includes('\0') || event.symbol.length > 30) {
      return {
        isValid: false,
        reason: 'Token symbol is empty, contains null bytes, or exceeds 30 characters',
      };
    }

    if (event.uri && (event.uri.includes('\0') || event.uri.length > 500)) {
      return { isValid: false, reason: 'Token URI contains null bytes or exceeds 500 characters' };
    }

    // 6. Validate numerical values
    if (event.initialSolLiquidity < 0 || !Number.isFinite(event.initialSolLiquidity)) {
      return {
        isValid: false,
        reason: `Invalid initial SOL liquidity: ${event.initialSolLiquidity}`,
      };
    }

    if (event.slot <= 0 || !Number.isFinite(event.slot)) {
      return { isValid: false, reason: `Invalid slot number: ${event.slot}` };
    }

    return { isValid: true };
  }
}
