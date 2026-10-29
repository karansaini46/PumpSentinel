import { EventEmitter } from 'node:events';
import type {
  DiscoveredToken,
  DiscoveryStats,
  DiscoveryFilterOptions,
  DiscoveryCursorRecord,
} from './discovery.types.js';
import type { IngestionTokenCreatedEvent } from '../ingestion/ingestion.types.js';
import { AddressValidator } from './address-validator.js';
import { tokenRepository } from '../persistence/token.repository.js';
import { cursorRepository } from '../persistence/cursor.repository.js';
import { metadataService } from '../metadata/metadata.service.js';
import { logger } from '../observability/logger.js';

export class DiscoveryService {
  private emitter = new EventEmitter();
  private tokenCache = new Map<string, DiscoveredToken>();
  private readonly maxCacheSize: number;

  // Stats & metrics
  private totalDiscoveredCount = 0;
  private metadataResolvedCount = 0;
  private eligibleCount = 0;
  private ineligibleCount = 0;
  private syntheticCount = 0;
  private duplicateCount = 0;
  private processingFailuresCount = 0;
  private totalLatencyAccumulatorMs = 0;

  private lastDiscoveredMint: string | null = null;
  private lastProcessedSlot = 0;
  private lastProcessedSignature: string | null = null;
  private filters: DiscoveryFilterOptions = {};
  private isInitialized = false;

  constructor(maxCacheSize = 500) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Initialize cursor watermark from PostgreSQL to resume processing after restarts
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const cursor = await cursorRepository.getCursor();
      if (cursor) {
        this.lastProcessedSlot = cursor.lastSlot;
        this.lastProcessedSignature = cursor.lastSignature;
        logger.info(
          { lastSlot: cursor.lastSlot, lastSignature: cursor.lastSignature },
          '[DiscoveryService] Resumed cursor from database',
        );
      } else {
        logger.info('[DiscoveryService] No existing cursor found. Starting fresh.');
      }
    } catch (err) {
      logger.warn({ err }, '[DiscoveryService] Could not load cursor during startup');
    }

    this.isInitialized = true;
  }

  public setFilters(filters: DiscoveryFilterOptions): void {
    this.filters = filters;
  }

  /**
   * Process a newly detected launch event through validation, deduplication,
   * persistence, metadata resolution, and risk-eligibility lifecycle transitions.
   */
  public async processTokenCreation(
    event: IngestionTokenCreatedEvent,
  ): Promise<DiscoveredToken | null> {
    // 1. Validate launch data and public keys
    const validation = AddressValidator.validateLaunchEvent(event);
    if (!validation.isValid) {
      this.processingFailuresCount += 1;
      logger.warn(
        { reason: validation.reason, mint: event.mint, signature: event.signature },
        '[DiscoveryService] Rejected malformed token launch event',
      );
      return null;
    }

    // 2. Check filters
    if (this.filters.minInitialSol && event.initialSolLiquidity < this.filters.minInitialSol) {
      logger.debug(
        { mint: event.mint, liquidity: event.initialSolLiquidity },
        '[DiscoveryService] Skipped token below min initial SOL filter',
      );
      return null;
    }

    if (this.filters.excludedSymbols?.includes(event.symbol.toUpperCase())) {
      logger.debug({ symbol: event.symbol }, '[DiscoveryService] Skipped blacklisted symbol');
      return null;
    }

    // 3. Deduplication via in-memory cache and persistent identifier
    if (this.tokenCache.has(event.mint)) {
      this.duplicateCount += 1;
      logger.debug({ mint: event.mint }, '[DiscoveryService] Duplicate token skipped');
      return null;
    }

    // 4. Calculate discovery latency
    const onChainTimestamp = new Date(event.timestamp);
    const receivedAt = event.receivedAt ?? new Date();
    const discoveryLatencyMs = Math.max(0, receivedAt.getTime() - onChainTimestamp.getTime());
    this.totalLatencyAccumulatorMs += discoveryLatencyMs;

    // 5. Track synthetic vs on-chain source
    const isSynthetic =
      event.source === 'mock' ||
      event.name.startsWith('[SYNTHETIC]') ||
      event.mint.startsWith('SyntH');

    if (isSynthetic) {
      this.syntheticCount += 1;
    }

    // 6. Watermark tracking (handle out-of-order slots gracefully)
    if (event.slot > this.lastProcessedSlot) {
      this.lastProcessedSlot = event.slot;
      this.lastProcessedSignature = event.signature;

      // Persist cursor asynchronously
      cursorRepository.saveCursor(event.slot, event.signature).catch((err) => {
        logger.debug({ err }, '[DiscoveryService] Failed to persist cursor');
      });
    }

    // 7. Stage 1: DISCOVERED_ON_CHAIN
    const token: DiscoveredToken = {
      mint: event.mint,
      name: event.name.trim(),
      symbol: event.symbol.trim(),
      uri: event.uri.trim(),
      creator: event.creator,
      bondingCurve: event.bondingCurve,
      signature: event.signature,
      slot: event.slot,
      initialLiquiditySol: event.initialSolLiquidity,
      bondingCurveProgress: 0,
      discoveredAt: new Date(),
      onChainTimestamp,
      discoveryLatencyMs,
      source: isSynthetic ? 'synthetic_replay' : event.source,
      isSynthetic,
      lifecycleState: 'DISCOVERED_ON_CHAIN',
      metadataStatus: 'PENDING',
    };

    // Bounded in-memory cache eviction (tuned for 8 GB RAM)
    if (this.tokenCache.size >= this.maxCacheSize) {
      const oldestKey = this.tokenCache.keys().next().value;
      if (oldestKey) this.tokenCache.delete(oldestKey);
    }
    this.tokenCache.set(token.mint, token);

    this.totalDiscoveredCount += 1;
    this.lastDiscoveredMint = token.mint;

    // Persist Stage 1 to PostgreSQL
    tokenRepository
      .upsertToken({
        mintAddress: token.mint,
        name: token.name,
        symbol: token.symbol,
        uri: token.uri,
        creator: token.creator,
        liquiditySol: token.initialLiquiditySol,
        bondingCurveProgress: 0,
        lifecycleState: token.lifecycleState,
        metadataStatus: token.metadataStatus,
        signature: token.signature,
        slot: token.slot,
        bondingCurveAddress: token.bondingCurve,
        source: token.source,
        isSynthetic: token.isSynthetic,
        discoveryLatencyMs: token.discoveryLatencyMs,
        onChainTimestamp: token.onChainTimestamp,
      })
      .catch((err) => {
        logger.debug(
          { err, mint: token.mint },
          '[DiscoveryService] Failed to persist initial token',
        );
      });

    logger.info(
      {
        mint: token.mint,
        symbol: token.symbol,
        source: token.source,
        latencyMs: token.discoveryLatencyMs,
      },
      '[DiscoveryService] Token discovered on-chain',
    );

    this.emitter.emit('tokenDiscoveredOnChain', token);

    // 8. Stage 2 & 3: Metadata Retrieval & Risk Eligibility Transitions
    await this.resolveMetadataAndEvaluateEligibility(token);

    return token;
  }

  /**
   * Progress token from DISCOVERED_ON_CHAIN -> METADATA_RETRIEVED -> ELIGIBLE_FOR_RISK_ANALYSIS
   */
  private async resolveMetadataAndEvaluateEligibility(token: DiscoveredToken): Promise<void> {
    if (!token.uri || token.uri.length === 0) {
      token.metadataStatus = 'MISSING';
      token.lifecycleState = 'ELIGIBLE_FOR_RISK_ANALYSIS'; // Eligible, but flagged as missing metadata
      this.eligibleCount += 1;

      await tokenRepository
        .updateLifecycle(token.mint, token.lifecycleState, token.metadataStatus)
        .catch(() => {});
      this.emitter.emit('tokenEligibleForRisk', token, null);
      return;
    }

    try {
      const meta = await metadataService.resolveMetadata(
        token.mint,
        token.uri,
        token.name,
        token.symbol,
      );

      token.metadataStatus = meta.hasValidUri ? 'RESOLVED' : 'FAILED';
      token.lifecycleState = 'METADATA_RETRIEVED';
      this.metadataResolvedCount += 1;
      this.emitter.emit('tokenMetadataRetrieved', token, meta);

      // Transition to Stage 3: ELIGIBLE_FOR_RISK_ANALYSIS
      token.lifecycleState = 'ELIGIBLE_FOR_RISK_ANALYSIS';
      this.eligibleCount += 1;

      await tokenRepository
        .updateLifecycle(token.mint, token.lifecycleState, token.metadataStatus)
        .catch(() => {});
      this.emitter.emit('tokenEligibleForRisk', token, meta);
    } catch {
      token.metadataStatus = 'FAILED';
      token.lifecycleState = 'ELIGIBLE_FOR_RISK_ANALYSIS';
      this.eligibleCount += 1;

      await tokenRepository
        .updateLifecycle(token.mint, token.lifecycleState, token.metadataStatus)
        .catch(() => {});
      this.emitter.emit('tokenEligibleForRisk', token, null);
    }
  }

  public getToken(mint: string): DiscoveredToken | undefined {
    return this.tokenCache.get(mint);
  }

  public getCachedTokens(): DiscoveredToken[] {
    return Array.from(this.tokenCache.values());
  }

  public getCursor(): DiscoveryCursorRecord {
    return {
      id: 'pump_fun_cursor',
      lastSlot: this.lastProcessedSlot,
      lastSignature: this.lastProcessedSignature,
      lastProcessedAt: new Date(),
    };
  }

  public getStats(): DiscoveryStats {
    const avgLatency =
      this.totalDiscoveredCount > 0
        ? Math.round(this.totalLatencyAccumulatorMs / this.totalDiscoveredCount)
        : 0;

    return {
      totalDiscovered: this.totalDiscoveredCount,
      metadataResolvedCount: this.metadataResolvedCount,
      eligibleCount: this.eligibleCount,
      ineligibleCount: this.ineligibleCount,
      syntheticCount: this.syntheticCount,
      duplicateCount: this.duplicateCount,
      processingFailuresCount: this.processingFailuresCount,
      averageDiscoveryLatencyMs: avgLatency,
      lastDiscoveredMint: this.lastDiscoveredMint,
      lastProcessedSlot: this.lastProcessedSlot,
      lastProcessedSignature: this.lastProcessedSignature,
      activeCacheSize: this.tokenCache.size,
    };
  }

  public onTokenDiscoveredOnChain(
    handler: (token: DiscoveredToken) => void | Promise<void>,
  ): () => void {
    this.emitter.on('tokenDiscoveredOnChain', handler);
    return () => {
      this.emitter.off('tokenDiscoveredOnChain', handler);
    };
  }

  public onTokenMetadataRetrieved(
    handler: (token: DiscoveredToken, meta: unknown) => void | Promise<void>,
  ): () => void {
    this.emitter.on('tokenMetadataRetrieved', handler);
    return () => {
      this.emitter.off('tokenMetadataRetrieved', handler);
    };
  }

  public onTokenEligibleForRisk(
    handler: (token: DiscoveredToken, meta: unknown) => void | Promise<void>,
  ): () => void {
    this.emitter.on('tokenEligibleForRisk', handler);
    return () => {
      this.emitter.off('tokenEligibleForRisk', handler);
    };
  }
}

export const discoveryService = new DiscoveryService();
