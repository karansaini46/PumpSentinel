import { describe, it, expect } from 'vitest';
import { EventDeduplicator } from '../../src/modules/ingestion/transport/deduplicator.js';

describe('EventDeduplicator', () => {
  it('returns true for new items and false for duplicates', () => {
    const dedup = new EventDeduplicator();

    expect(dedup.testAndAdd('sig_1')).toBe(true);
    expect(dedup.testAndAdd('sig_1')).toBe(false);
    expect(dedup.testAndAdd('sig_2')).toBe(true);

    expect(dedup.has('sig_1')).toBe(true);
    expect(dedup.has('sig_2')).toBe(true);
    expect(dedup.has('sig_3')).toBe(false);

    expect(dedup.stats.duplicatesPrevented).toBe(1);
  });

  it('evicts oldest items when capacity limit is reached', () => {
    const dedup = new EventDeduplicator({ maxSize: 3 });

    dedup.testAndAdd('item_1');
    dedup.testAndAdd('item_2');
    dedup.testAndAdd('item_3');
    expect(dedup.stats.size).toBe(3);

    // Adding 4th should evict item_1
    dedup.testAndAdd('item_4');
    expect(dedup.stats.size).toBe(3);
    expect(dedup.has('item_1')).toBe(false);
    expect(dedup.has('item_4')).toBe(true);
  });

  it('expires items after TTL has elapsed', async () => {
    const dedup = new EventDeduplicator({ ttlMs: 50 });

    dedup.testAndAdd('temp_item');
    expect(dedup.has('temp_item')).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    expect(dedup.has('temp_item')).toBe(false);
    // Can re-add after TTL
    expect(dedup.testAndAdd('temp_item')).toBe(true);
  });
});
