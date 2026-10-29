import { SYNTHETIC_TOKEN_FIXTURES } from './fixtures/synthetic-fixtures.js';
import type { IngestionTokenCreatedEvent } from '../ingestion/ingestion.types.js';
import { logger } from '../observability/logger.js';

export interface ReplayOptions {
  intervalMs?: number;
  customFixtures?: IngestionTokenCreatedEvent[];
  onEvent?: (event: IngestionTokenCreatedEvent) => Promise<void> | void;
}

export class ReplayService {
  private isReplaying = false;

  public async replay(options: ReplayOptions = {}): Promise<number> {
    const fixtures = options.customFixtures ?? SYNTHETIC_TOKEN_FIXTURES;
    const interval = options.intervalMs ?? 0;
    this.isReplaying = true;

    logger.info(
      { count: fixtures.length, intervalMs: interval },
      '[ReplayService] Starting development replay mode',
    );

    let replayedCount = 0;

    for (const fixture of fixtures) {
      if (!this.isReplaying) break;

      // Explicit requirement: Synthetic tokens must be labeled as synthetic
      const syntheticEvent: IngestionTokenCreatedEvent = {
        ...fixture,
        timestamp: Date.now(),
        receivedAt: new Date(),
        source: 'mock',
      };

      if (options.onEvent) {
        await options.onEvent(syntheticEvent);
      }

      replayedCount += 1;

      if (interval > 0) {
        await new Promise((r) => setTimeout(r, interval));
      }
    }

    this.isReplaying = false;
    logger.info({ replayedCount }, '[ReplayService] Replay mode completed');
    return replayedCount;
  }

  public stop(): void {
    this.isReplaying = false;
  }
}

export const replayService = new ReplayService();
