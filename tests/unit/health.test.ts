import { describe, it, expect } from 'vitest';
import { HealthService } from '../../src/modules/observability/health.service.js';
import { getMemoryReport } from '../../src/modules/observability/system-metrics.js';

describe('Observability & Health Module', () => {
  it('reports memory usage accurately', () => {
    const mem = getMemoryReport();
    expect(mem.rssMb).toBeGreaterThan(0);
    expect(mem.heapTotalMb).toBeGreaterThan(0);
    expect(mem.heapUsedMb).toBeGreaterThan(0);
    expect(typeof mem.isMemoryConstrained).toBe('boolean');
  });

  it('aggregates healthy subsystem checks', async () => {
    const health = new HealthService();
    health.registerCheck('test_db', async () => ({
      status: 'ok',
      details: { ping: true },
    }));

    const result = await health.evaluateHealth();
    expect(result.status).toBe('ok');
    expect(result.checks['test_db']?.status).toBe('ok');
    expect(result.checks['test_db']?.details?.['ping']).toBe(true);
  });

  it('marks overall status as down if any critical probe fails', async () => {
    const health = new HealthService();
    health.registerCheck('failing_service', async () => {
      throw new Error('Database connection refused');
    });

    const result = await health.evaluateHealth();
    expect(result.status).toBe('down');
    expect(result.checks['failing_service']?.status).toBe('down');
    expect(result.checks['failing_service']?.error).toContain('Database connection refused');
  });
});
