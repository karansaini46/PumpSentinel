import { z } from 'zod';
import type { SolanaRpcClient } from '../ingestion/transport/rpc-client.js';
import type { HistoricalCoverageReport } from './wallet-history.types.js';
import { logger } from '../observability/logger.js';

export const RawSignatureSchema = z.object({
  signature: z.string(),
  slot: z.number(),
  err: z.any().nullable().optional(),
  memo: z.string().nullable().optional(),
  blockTime: z.number().nullable().optional(),
});

export type RawSignatureItem = z.infer<typeof RawSignatureSchema>;

export interface PaginationOptions {
  pageSize?: number;
  maxPages?: number;
  maxSignatures?: number;
  beforeSignature?: string;
  untilSignature?: string;
}

export interface PaginatedSignaturesResult {
  signatures: RawSignatureItem[];
  coverage: HistoricalCoverageReport;
}

export class HistoryPaginator {
  private readonly rpcClient: SolanaRpcClient;

  constructor(rpcClient: SolanaRpcClient) {
    this.rpcClient = rpcClient;
  }

  /**
   * Safely paginates signatures for an address using `before` cursor.
   * Enforces strict bounds on page count and total signatures to respect provider limits.
   */
  public async getSignaturesPaged(
    address: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedSignaturesResult> {
    const pageSize = Math.min(100, Math.max(10, options.pageSize ?? 50));
    const maxPages = Math.min(5, Math.max(1, options.maxPages ?? 3));
    const maxSignatures = options.maxSignatures ?? 150;

    const allSignatures: RawSignatureItem[] = [];
    let beforeCursor = options.beforeSignature;
    let isTruncated = false;
    let pageCount = 0;

    while (pageCount < maxPages && allSignatures.length < maxSignatures) {
      pageCount += 1;
      const params: unknown[] = [
        address,
        {
          limit: pageSize,
          commitment: 'confirmed',
          ...(beforeCursor ? { before: beforeCursor } : {}),
          ...(options.untilSignature ? { until: options.untilSignature } : {}),
        },
      ];

      try {
        const batch = await this.rpcClient.call(
          'getSignaturesForAddress',
          params,
          z.array(RawSignatureSchema),
        );

        if (!batch || batch.length === 0) {
          // Reached end of history
          break;
        }

        allSignatures.push(...batch);

        const lastItem = batch[batch.length - 1];
        if (!lastItem) break;
        beforeCursor = lastItem.signature;

        if (batch.length < pageSize) {
          // Received less than requested page size -> natural end of history
          break;
        }

        if (pageCount >= maxPages || allSignatures.length >= maxSignatures) {
          isTruncated = true;
          break;
        }
      } catch (err) {
        logger.debug(
          { address, pageCount, err },
          '[HistoryPaginator] Batch fetch encountered error or limit reached',
        );
        isTruncated = true;
        break;
      }
    }

    // Determine coverage and temporal period
    let startTime: Date | null = null;
    let endTime: Date | null = null;
    let startSlot: number | null = null;
    let endSlot: number | null = null;

    if (allSignatures.length > 0) {
      const times = allSignatures
        .map((s) => s.blockTime)
        .filter((t): t is number => typeof t === 'number' && t > 0)
        .map((t) => t * 1000);

      if (times.length > 0) {
        startTime = new Date(Math.min(...times));
        endTime = new Date(Math.max(...times));
      }

      const slots = allSignatures.map((s) => s.slot);
      startSlot = Math.min(...slots);
      endSlot = Math.max(...slots);
    }

    let coverageType: HistoricalCoverageReport['coverage'] = 'FULL_HISTORY';
    if (allSignatures.length <= 2) {
      coverageType = 'INSUFFICIENT_HISTORY';
    } else if (isTruncated) {
      coverageType = 'TRUNCATED_BY_BUDGET';
    }

    const coverage: HistoricalCoverageReport = {
      coverage: coverageType,
      startTime,
      endTime,
      startSlot,
      endSlot,
      totalSignaturesObserved: allSignatures.length,
      isTruncated,
      reason: isTruncated
        ? `History bounded to ${allSignatures.length} signatures across ${pageCount} pages to respect RPC limits`
        : undefined,
    };

    return {
      signatures: allSignatures,
      coverage,
    };
  }
}
