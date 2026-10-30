import { logger } from './logger.js';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number; // Number of consecutive errors before tripping (default: 5)
  cooldownMs?: number; // Duration to remain open before half-open probe (default: 30000ms)
  successThreshold?: number; // Consecutive successes in half-open before closing (default: 2)
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
}

export class CircuitBreakerOpenError extends Error {
  public readonly retryAfterMs: number;

  constructor(
    public readonly breakerName: string,
    retryAfterMs: number,
  ) {
    super(
      `Circuit breaker [${breakerName}] is OPEN. Outbound requests halted to protect downstream services. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = 'CircuitBreakerOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalExecutions: number;
  totalTrips: number;
  lastStateChange: Date;
}

export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly successThreshold: number;
  private readonly onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;

  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalExecutions = 0;
  private totalTrips = 0;
  private lastStateChange: Date = new Date();
  private openedAt = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name ?? 'default';
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 5);
    this.cooldownMs = Math.max(1000, options.cooldownMs ?? 30000);
    this.successThreshold = Math.max(1, options.successThreshold ?? 2);
    this.onStateChange = options.onStateChange;
  }

  public getState(): CircuitBreakerState {
    this.checkCooldown();
    return this.state;
  }

  public getMetrics(): CircuitBreakerMetrics {
    this.checkCooldown();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalExecutions: this.totalExecutions,
      totalTrips: this.totalTrips,
      lastStateChange: this.lastStateChange,
    };
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkCooldown();

    if (this.state === 'OPEN') {
      const remainingCooldown = Math.max(0, this.cooldownMs - (Date.now() - this.openedAt));
      throw new CircuitBreakerOpenError(this.name, remainingCooldown);
    }

    this.totalExecutions += 1;

    try {
      const result = await fn();
      this.handleSuccess();
      return result;
    } catch (err) {
      this.handleFailure(err);
      throw err;
    }
  }

  private handleSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.transitionTo('CLOSED');
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
      }
    } else if (this.state === 'CLOSED') {
      this.consecutiveFailures = 0;
    }
  }

  private handleFailure(err: unknown): void {
    this.consecutiveFailures += 1;

    if (this.state === 'HALF_OPEN') {
      logger.warn(
        { breaker: this.name, err },
        '[CircuitBreaker] Probe failed in HALF_OPEN state. Tripping back to OPEN.',
      );
      this.trip();
    } else if (this.state === 'CLOSED' && this.consecutiveFailures >= this.failureThreshold) {
      logger.warn(
        {
          breaker: this.name,
          failures: this.consecutiveFailures,
          threshold: this.failureThreshold,
        },
        '[CircuitBreaker] Failure threshold breached. Tripping circuit to OPEN.',
      );
      this.trip();
    }
  }

  private checkCooldown(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.cooldownMs) {
        this.transitionTo('HALF_OPEN');
        this.consecutiveSuccesses = 0;
      }
    }
  }

  public trip(): void {
    this.openedAt = Date.now();
    this.totalTrips += 1;
    this.transitionTo('OPEN');
  }

  public reset(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openedAt = 0;
    this.transitionTo('CLOSED');
  }

  private transitionTo(nextState: CircuitBreakerState): void {
    if (this.state === nextState) return;
    const prevState = this.state;
    this.state = nextState;
    this.lastStateChange = new Date();

    logger.info(
      { breaker: this.name, from: prevState, to: nextState },
      `[CircuitBreaker] State transition: ${prevState} -> ${nextState}`,
    );

    if (this.onStateChange) {
      try {
        this.onStateChange(prevState, nextState);
      } catch (err) {
        logger.error(
          { err, breaker: this.name },
          '[CircuitBreaker] Error in onStateChange callback',
        );
      }
    }
  }
}
