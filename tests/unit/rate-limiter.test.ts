import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../src/modules/ingestion/transport/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows immediate requests within burst capacity', async () => {
    const limiter = new RateLimiter({ maxRequestsPerSecond: 5 });
    const start = Date.now();

    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('throttles when tokens are exhausted and refills over time', async () => {
    const limiter = new RateLimiter({ maxRequestsPerSecond: 10 });

    // Consume all 10 tokens
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }

    const start = Date.now();
    // 11th request must wait for token refill (~100ms)
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it('rejects with queue full error when max queue capacity is exceeded', async () => {
    const limiter = new RateLimiter({ maxRequestsPerSecond: 1, maxQueueSize: 2 });
    await limiter.acquire(); // tokens = 0

    // Queue 2 requests
    const p1 = limiter.acquire();
    const p2 = limiter.acquire();

    // 3rd should reject
    await expect(limiter.acquire()).rejects.toThrow(/Request queue full/);

    await Promise.all([p1, p2]);
  });
});
