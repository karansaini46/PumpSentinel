import { getMemoryReport, type MemoryReport } from './system-metrics.js';
import { logger } from './logger.js';

export type HealthState = 'ok' | 'degraded' | 'down';

export interface ComponentHealth {
  status: HealthState;
  details?: Record<string, unknown>;
  error?: string;
  checkedAt: string;
}

export interface SystemHealthReport {
  status: HealthState;
  timestamp: string;
  uptimeSeconds: number;
  memory: MemoryReport;
  checks: Record<string, ComponentHealth>;
}

export type HealthCheckFn = () => Promise<{
  status: HealthState;
  details?: Record<string, unknown>;
}>;

export class HealthService {
  private checks = new Map<string, HealthCheckFn>();

  public registerCheck(name: string, checkFn: HealthCheckFn): void {
    this.checks.set(name, checkFn);
  }

  public async evaluateHealth(): Promise<SystemHealthReport> {
    const memory = getMemoryReport();
    const checksReport: Record<string, ComponentHealth> = {};
    let overallStatus: HealthState = 'ok';

    // Memory constraint check
    if (memory.isMemoryConstrained) {
      overallStatus = 'degraded';
      checksReport['memory'] = {
        status: 'degraded',
        details: {
          warning: 'High memory pressure detected. System tuned for 8 GB RAM.',
          rssMb: memory.rssMb,
          osUsedPercent: memory.osUsedPercent,
        },
        checkedAt: new Date().toISOString(),
      };
    } else {
      checksReport['memory'] = {
        status: 'ok',
        details: {
          rssMb: memory.rssMb,
          heapUsedMb: memory.heapUsedMb,
        },
        checkedAt: new Date().toISOString(),
      };
    }

    // Evaluate registered subsystem checks
    for (const [name, fn] of this.checks.entries()) {
      try {
        const result = await fn();
        checksReport[name] = {
          status: result.status,
          details: result.details,
          checkedAt: new Date().toISOString(),
        };

        if (result.status === 'down') {
          overallStatus = 'down';
        } else if (result.status === 'degraded' && overallStatus !== 'down') {
          overallStatus = 'degraded';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, check: name }, `Health check failed for: ${name}`);
        checksReport[name] = {
          status: 'down',
          error: message,
          checkedAt: new Date().toISOString(),
        };
        overallStatus = 'down';
      }
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory,
      checks: checksReport,
    };
  }
}

export const healthService = new HealthService();
