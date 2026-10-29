import {
  type AnalyzedField,
  type FieldStatus,
  createField,
  createUnknownField,
  createContradictoryField,
  DEFAULT_STALE_THRESHOLD_MS,
  evaluateFreshness,
} from '../analysis.types.js';
import { AddressValidator } from '../../discovery/address-validator.js';

export interface SourceCandidate<T> {
  source: string;
  value: T | null | undefined;
  observedAt?: Date;
  isDirect?: boolean;
  priority?: number; // Higher number = higher authority (e.g. on-chain RPC = 10, external API = 5)
}

export class DataReconciler {
  /**
   * Reconcile a numeric field across one or more candidate sources.
   * Handles missing, malformed, stale, and contradictory data.
   */
  public reconcileNumeric(
    fieldName: string,
    candidates: SourceCandidate<number>[],
    options: {
      min?: number;
      max?: number;
      allowZero?: boolean;
      staleThresholdMs?: number;
    } = {},
  ): AnalyzedField<number> {
    const staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

    // Filter valid vs malformed
    const validCandidates: Array<{
      source: string;
      value: number;
      observedAt: Date;
      priority: number;
      isDirect: boolean;
    }> = [];

    const malformedReasons: string[] = [];

    for (const c of candidates) {
      if (c.value === null || c.value === undefined) {
        continue;
      }

      const num = Number(c.value);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        malformedReasons.push(`${c.source}: value is not a finite number ("${String(c.value)}")`);
        continue;
      }

      if (options.min !== undefined && num < options.min) {
        malformedReasons.push(
          `${c.source}: value ${num} is below minimum allowed (${options.min})`,
        );
        continue;
      }

      if (options.max !== undefined && num > options.max) {
        malformedReasons.push(
          `${c.source}: value ${num} is above maximum allowed (${options.max})`,
        );
        continue;
      }

      validCandidates.push({
        source: c.source,
        value: num,
        observedAt: c.observedAt ?? new Date(),
        priority: c.priority ?? 5,
        isDirect: c.isDirect ?? true,
      });
    }

    // Case 1: Missing / All malformed
    const firstCandidate = candidates[0];
    const defaultSource = firstCandidate?.source ?? 'unknown_source';

    if (validCandidates.length === 0) {
      const reason =
        malformedReasons.length > 0
          ? `Malformed data rejected: ${malformedReasons.join('; ')}`
          : `Data unavailable from all sources for field "${fieldName}"`;
      return createUnknownField<number>(defaultSource, reason, 'DIRECT');
    }

    // Sort by priority desc, then recency desc
    validCandidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.observedAt.getTime() - a.observedAt.getTime();
    });

    const primary = validCandidates[0];
    if (!primary) {
      return createUnknownField<number>(defaultSource, `Data unavailable for "${fieldName}"`);
    }

    // Case 2: Check for contradictions across sources
    const conflicting = validCandidates.filter((other) => {
      if (other.source === primary.source) return false;
      const diff = Math.abs(other.value - primary.value);
      const relativeDiff = primary.value !== 0 ? diff / Math.abs(primary.value) : diff;
      return relativeDiff > 0.05 && diff > 0.00001;
    });

    if (conflicting.length > 0) {
      const conflictSummary = conflicting.map((c) => `${c.source}=${c.value}`).join(', ');
      return createContradictoryField<number>(
        primary.value,
        primary.source,
        `Contradiction detected: ${primary.source} reported ${primary.value}, but competing sources reported: ${conflictSummary}. Reconciled to higher authority ${primary.source}.`,
        primary.isDirect ? 'DIRECT' : 'INFERRED',
      );
    }

    // Case 3: Check staleness
    const { freshness } = evaluateFreshness(primary.observedAt, staleThresholdMs);
    let status: FieldStatus = 'CONFIRMED';
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = primary.isDirect ? 'HIGH' : 'MEDIUM';

    if (freshness === 'STALE' || freshness === 'EXPIRED') {
      status = 'STALE';
      confidence = 'LOW';
    }

    return createField<number>(primary.value, {
      source: primary.source,
      observedAt: primary.observedAt,
      confidence,
      nature: primary.isDirect ? 'DIRECT' : 'INFERRED',
      status,
      staleThresholdMs,
    });
  }

  /**
   * Reconcile a public key / address field.
   * Enforces base58 format validation.
   */
  public reconcileAddress(
    fieldName: string,
    candidates: SourceCandidate<string>[],
  ): AnalyzedField<string> {
    for (const c of candidates) {
      if (!c.value || typeof c.value !== 'string' || c.value.trim() === '') {
        continue;
      }

      const trimmed = c.value.trim();
      const isValid = AddressValidator.isValidSolanaAddress(trimmed);
      if (!isValid) {
        return createUnknownField<string>(
          c.source,
          `Malformed address for ${fieldName}: "${trimmed}" is not a valid 32-byte Solana address`,
        );
      }

      return createField<string>(trimmed, {
        source: c.source,
        observedAt: c.observedAt ?? new Date(),
        confidence: 'HIGH',
        nature: c.isDirect !== false ? 'DIRECT' : 'INFERRED',
      });
    }

    const first = candidates[0];
    return createUnknownField<string>(
      first?.source ?? 'unknown_source',
      `Address for ${fieldName} is unavailable`,
    );
  }

  /**
   * Reconcile authority status (e.g. mintAuthority, freezeAuthority).
   * Validates nullable public keys and detects revocations.
   */
  public reconcileAuthority(
    authorityName: string,
    candidates: SourceCandidate<string | null>[],
  ): {
    authority: AnalyzedField<string | null>;
    isRevoked: AnalyzedField<boolean>;
  } {
    const valid = candidates.filter((c) => c.value !== undefined);
    if (valid.length === 0) {
      return {
        authority: createUnknownField<string | null>(
          'solana_rpc',
          `${authorityName} data unavailable`,
        ),
        isRevoked: createUnknownField<boolean>('solana_rpc', `${authorityName} status unavailable`),
      };
    }

    const nonNulls = valid.filter((c) => typeof c.value === 'string' && c.value.trim() !== '');
    const nulls = valid.filter((c) => c.value === null);

    const firstNonNull = nonNulls[0];
    const firstNull = nulls[0];

    if (firstNonNull && firstNull && typeof firstNonNull.value === 'string') {
      const activeSource = firstNonNull.source;
      const revokedSource = firstNull.source;
      return {
        authority: createContradictoryField<string | null>(
          firstNonNull.value,
          activeSource,
          `Contradictory authority status: ${activeSource} reports active authority (${firstNonNull.value}), but ${revokedSource} reports null (revoked).`,
        ),
        isRevoked: createContradictoryField<boolean>(
          false,
          activeSource,
          `Contradictory revocation status between ${activeSource} and ${revokedSource}.`,
        ),
      };
    }

    if (firstNonNull && typeof firstNonNull.value === 'string') {
      const trimmed = firstNonNull.value.trim();
      const isValid = AddressValidator.isValidSolanaAddress(trimmed);
      if (!isValid) {
        return {
          authority: createUnknownField<string | null>(
            firstNonNull.source,
            `Malformed ${authorityName} address: "${trimmed}" is not a valid 32-byte Solana address`,
          ),
          isRevoked: createUnknownField<boolean>(
            firstNonNull.source,
            `Malformed ${authorityName} address`,
          ),
        };
      }

      return {
        authority: createField<string | null>(trimmed, {
          source: firstNonNull.source,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
        isRevoked: createField<boolean>(false, {
          source: firstNonNull.source,
          confidence: 'HIGH',
          nature: 'DIRECT',
        }),
      };
    }

    // Otherwise it is confirmed null (revoked)
    const c = firstNull ?? valid[0];
    const sourceName = c?.source ?? 'solana_rpc';
    return {
      authority: createField<string | null>(null, {
        source: sourceName,
        confidence: 'HIGH',
        nature: 'DIRECT',
      }),
      isRevoked: createField<boolean>(true, {
        source: sourceName,
        confidence: 'HIGH',
        nature: 'DIRECT',
      }),
    };
  }
}

export const dataReconciler = new DataReconciler();
