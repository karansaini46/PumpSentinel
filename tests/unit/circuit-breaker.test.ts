import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '../../src/modules/observability/circuit-breaker.js';

describe('CircuitBreaker Unit Tests', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('starts in CLOSED state with 0 failures', () => {
    const breaker = new CircuitBreaker({ name: 'test-breaker' });
    expect(breaker.getState()).toBe('CLOSED');
    const metrics = breaker.getMetrics();
    expect(metrics.state).toBe('CLOSED');
    expect(metrics.consecutiveFailures).toBe(0);
    expect(metrics.totalTrips).toBe(0);
  });

  it('allows successful executions and stays CLOSED', async () => {
    const breaker = new CircuitBreaker({ name: 'test-breaker' });
    const fn = vi.fn().mockResolvedValue('success');

    const result = await breaker.execute(fn);
    expect(result).toBe('success');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(0);
  });

  it('trips to OPEN state after reaching failureThreshold', async () => {
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({
      name: 'test-breaker',
      failureThreshold: 3,
      cooldownMs: 5000,
      onStateChange,
    });

    const failingFn = vi.fn().mockRejectedValue(new Error('Network error'));

    // 1st failure
    await expect(breaker.execute(failingFn)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(1);

    // 2nd failure
    await expect(breaker.execute(failingFn)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(2);

    // 3rd failure: trips breaker
    await expect(breaker.execute(failingFn)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.getMetrics().totalTrips).toBe(1);
    expect(onStateChange).toHaveBeenCalledWith('CLOSED', 'OPEN');
  });

  it('immediately blocks calls with CircuitBreakerOpenError when OPEN', async () => {
    const breaker = new CircuitBreaker({
      name: 'test-breaker',
      failureThreshold: 1,
      cooldownMs: 5000,
    });

    const failingFn = vi.fn().mockRejectedValue(new Error('Downstream failure'));
    await expect(breaker.execute(failingFn)).rejects.toThrow('Downstream failure');
    expect(breaker.getState()).toBe('OPEN');

    const subsequentFn = vi.fn().mockResolvedValue('ok');
    await expect(breaker.execute(subsequentFn)).rejects.toThrow(CircuitBreakerOpenError);
    expect(subsequentFn).not.toHaveBeenCalled();
  });

  it('transitions to HALF_OPEN after cooldown period and closes after successful probes', async () => {
    vi.useFakeTimers();
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({
      name: 'test-breaker',
      failureThreshold: 2,
      cooldownMs: 10000,
      successThreshold: 2,
      onStateChange,
    });

    const failingFn = vi.fn().mockRejectedValue(new Error('Failure'));
    await expect(breaker.execute(failingFn)).rejects.toThrow();
    await expect(breaker.execute(failingFn)).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    // Advance time past cooldown
    vi.advanceTimersByTime(10001);
    expect(breaker.getState()).toBe('HALF_OPEN');

    // 1st probe success
    const probeFn = vi.fn().mockResolvedValue('recovered');
    const res1 = await breaker.execute(probeFn);
    expect(res1).toBe('recovered');
    expect(breaker.getState()).toBe('HALF_OPEN');

    // 2nd probe success closes the circuit
    const res2 = await breaker.execute(probeFn);
    expect(res2).toBe('recovered');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(0);
    expect(onStateChange).toHaveBeenCalledWith('HALF_OPEN', 'CLOSED');

    vi.useRealTimers();
  });

  it('re-trips to OPEN if a probe fails during HALF_OPEN', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      name: 'test-breaker',
      failureThreshold: 1,
      cooldownMs: 5000,
      successThreshold: 2,
    });

    await expect(breaker.execute(() => Promise.reject(new Error('Crash')))).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    vi.advanceTimersByTime(5001);
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Probe fails
    await expect(breaker.execute(() => Promise.reject(new Error('Still down')))).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    vi.useRealTimers();
  });

  it('supports manual reset and trip', () => {
    const breaker = new CircuitBreaker({ name: 'manual-breaker' });
    expect(breaker.getState()).toBe('CLOSED');

    breaker.trip();
    expect(breaker.getState()).toBe('OPEN');

    breaker.reset();
    expect(breaker.getState()).toBe('CLOSED');
  });
});
