import { describe, it, expect } from 'vitest';
import {
  RequestBudget,
  BoundedConcurrencyQueue,
} from '../../src/modules/analysis/budget/request-budget.js';
import { BoundedTtlCache } from '../../src/modules/analysis/cache/analysis-cache.js';

describe('Resource Management: Request Budget, Concurrency, and Caching', () => {
  describe('RequestBudget', () => {
    it('tracks RPC call units and refuses consumption once budget is exhausted', () => {
      const budget = new RequestBudget(5);

      expect(budget.getLimit()).toBe(5);
      expect(budget.getRemaining()).toBe(5);
      expect(budget.isExhausted()).toBe(false);

      expect(budget.consume(3)).toBe(true);
      expect(budget.getUsed()).toBe(3);
      expect(budget.getRemaining()).toBe(2);

      // Consuming 3 units when only 2 remain should fail
      expect(budget.canConsume(3)).toBe(false);
      expect(budget.consume(3)).toBe(false);
      expect(budget.getUsed()).toBe(3); // unchanged

      // Consuming 2 units exhausts the budget
      expect(budget.consume(2)).toBe(true);
      expect(budget.isExhausted()).toBe(true);
      expect(budget.getRemaining()).toBe(0);

      // Any further call fails
      expect(budget.consume(1)).toBe(false);
    });
  });

  describe('BoundedConcurrencyQueue', () => {
    it('limits concurrent tasks to configured maximum', async () => {
      const queue = new BoundedConcurrencyQueue(2, 10);
      let activePeak = 0;
      let activeCurrent = 0;

      const runTask = async (ms: number) => {
        return queue.run(async () => {
          activeCurrent += 1;
          activePeak = Math.max(activePeak, activeCurrent);
          await new Promise((r) => setTimeout(r, ms));
          activeCurrent -= 1;
          return true;
        });
      };

      // Launch 5 tasks concurrently
      const promises = [runTask(50), runTask(50), runTask(50), runTask(50), runTask(50)];

      await Promise.all(promises);

      // Peak concurrency should never exceed 2
      expect(activePeak).toBeLessThanOrEqual(2);
      expect(queue.getActiveCount()).toBe(0);
      expect(queue.getQueueLength()).toBe(0);
    });

    it('rejects tasks when queue reaches maximum capacity', async () => {
      // Concurrency 1, queue capacity 2
      const queue = new BoundedConcurrencyQueue(1, 2);

      const slowTask = () => new Promise<void>((r) => setTimeout(r, 100));

      // 1 active, 2 queued = total 3
      const p1 = queue.run(slowTask);
      const p2 = queue.run(slowTask);
      const p3 = queue.run(slowTask);

      // 4th task should be rejected immediately due to queue full
      await expect(queue.run(slowTask)).rejects.toThrow(/Queue full/);

      await Promise.all([p1, p2, p3]);
    });
  });

  describe('BoundedTtlCache', () => {
    it('retrieves cached value before TTL and returns undefined after expiration', async () => {
      const cache = new BoundedTtlCache<string>(10, 50); // 50ms TTL

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      // Wait for TTL expiration
      await new Promise((r) => setTimeout(r, 70));
      expect(cache.get('key1')).toBeUndefined();
    });

    it('evicts least recently used item when max capacity is reached', () => {
      const cache = new BoundedTtlCache<number>(3, 60000);

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' so 'b' becomes the oldest
      expect(cache.get('a')).toBe(1);

      // Add 'd', should evict 'b'
      cache.set('d', 4);

      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
      expect(cache.size()).toBe(3);
    });
  });
});
