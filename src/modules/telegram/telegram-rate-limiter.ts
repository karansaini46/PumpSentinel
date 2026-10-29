/**
 * Telegram Rate Limiter: Per-user sliding-window rate limiter
 * to protect the bot from command spam and API exhaustion.
 */
export interface RateLimiterConfig {
  /** Maximum allowed requests within the time window. Default: 15 */
  maxRequests: number;
  /** Sliding window duration in milliseconds. Default: 10,000 ms (10 seconds) */
  windowMs: number;
}

export class TelegramRateLimiter {
  private userTimestamps = new Map<number, number[]>();
  private config: RateLimiterConfig;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = {
      maxRequests: config?.maxRequests ?? 15,
      windowMs: config?.windowMs ?? 10000,
    };
  }

  /**
   * Checks whether the user is permitted to execute a command.
   * Returns allowed status and remaining cool-down seconds if blocked.
   */
  public checkLimit(
    userId: number,
    nowMs: number = Date.now(),
  ): { allowed: boolean; retryAfterSeconds?: number } {
    const windowStart = nowMs - this.config.windowMs;
    const timestamps = this.userTimestamps.get(userId) ?? [];

    // Filter out timestamps outside the sliding window
    const recent = timestamps.filter((t) => t > windowStart);

    if (recent.length >= this.config.maxRequests) {
      const oldestInWindow = recent[0]!;
      const retryAfterMs = oldestInWindow + this.config.windowMs - nowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

      this.userTimestamps.set(userId, recent);
      return {
        allowed: false,
        retryAfterSeconds,
      };
    }

    recent.push(nowMs);
    this.userTimestamps.set(userId, recent);

    // Periodic cleanup if map grows large (> 500 users)
    if (this.userTimestamps.size > 500) {
      this.cleanup(nowMs);
    }

    return { allowed: true };
  }

  /**
   * Cleans up expired user tracking entries.
   */
  public cleanup(nowMs: number = Date.now()): void {
    const windowStart = nowMs - this.config.windowMs;
    for (const [userId, timestamps] of this.userTimestamps.entries()) {
      const active = timestamps.filter((t) => t > windowStart);
      if (active.length === 0) {
        this.userTimestamps.delete(userId);
      } else {
        this.userTimestamps.set(userId, active);
      }
    }
  }

  public reset(userId?: number): void {
    if (userId !== undefined) {
      this.userTimestamps.delete(userId);
    } else {
      this.userTimestamps.clear();
    }
  }
}

export const telegramRateLimiter = new TelegramRateLimiter();
