#!/usr/bin/env node
import { configService } from '../modules/configuration/config.service.js';
import { healthService } from '../modules/observability/health.service.js';
import { prismaService } from '../modules/persistence/prisma.service.js';
import { logger } from '../modules/observability/logger.js';

async function runHealthCheck(): Promise<void> {
  console.log('====================================================');
  console.log('       🛡️  PumpSentinel System Health Check        ');
  console.log('====================================================\n');

  // Register database probe
  healthService.registerCheck('database', async () => {
    try {
      const isAlive = await prismaService.ping();
      return {
        status: isAlive ? 'ok' : 'degraded',
        details: {
          connected: isAlive,
          hint: isAlive
            ? 'PostgreSQL responding'
            : 'PostgreSQL offline or starting. Run: docker compose up -d postgres',
        },
      };
    } catch (err) {
      return {
        status: 'degraded',
        details: {
          error: err instanceof Error ? err.message : String(err),
          hint: 'Run: docker compose up -d postgres',
        },
      };
    }
  });

  // Register config probe
  healthService.registerCheck('configuration', async () => {
    try {
      const config = configService.getAll();
      return {
        status: 'ok',
        details: {
          nodeEnv: config.NODE_ENV,
          simulatedTradingOnly: true,
          initialBalanceSol: config.PAPER_INITIAL_SOL_BALANCE,
          maxCacheTokens: config.MAX_CACHE_TOKENS,
        },
      };
    } catch (err) {
      return {
        status: 'down',
        details: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  });

  // Register Solana data provider probe
  healthService.registerCheck('solana_data_provider', async () => {
    const { ingestionStreamService } = await import('../modules/ingestion/stream.service.js');
    const health = ingestionStreamService.getHealth();
    return {
      status: health.status === 'ERROR' ? 'degraded' : 'ok',
      details: {
        provider: health.name,
        source: health.source,
        status: health.status,
        endpoint: health.sanitizedEndpoint,
        eventsProcessed: health.eventsProcessed,
        duplicatesPrevented: health.duplicatesPrevented,
        reconnectCount: health.reconnectCount,
      },
    };
  });

  try {
    const report = await healthService.evaluateHealth();
    const mem = report.memory;

    console.log(
      `[Status]       ${report.status === 'ok' ? '✅ HEALTHY' : report.status === 'degraded' ? '⚠️ DEGRADED' : '❌ DOWN'}`,
    );
    console.log(`[Timestamp]    ${report.timestamp}`);
    console.log(`[Uptime]       ${report.uptimeSeconds} seconds`);
    console.log(`\n--- Memory Utilization (Tuned for 8 GB RAM) ---`);
    console.log(`• Process RSS:     ${mem.rssMb} MB`);
    console.log(`• Heap Used:       ${mem.heapUsedMb} MB / ${mem.heapTotalMb} MB`);
    console.log(`• OS Memory Used:  ${mem.osUsedPercent}% (Free: ${mem.osFreeMb} MB)`);
    console.log(`• Constrained:     ${mem.isMemoryConstrained ? '⚠️ YES' : '✅ NO'}`);

    console.log(`\n--- Subsystem Checks ---`);
    for (const [name, check] of Object.entries(report.checks)) {
      const icon = check.status === 'ok' ? '✅' : check.status === 'degraded' ? '⚠️' : '❌';
      console.log(`${icon} [${name.toUpperCase()}]: ${check.status}`);
      if (check.details) {
        for (const [k, v] of Object.entries(check.details)) {
          console.log(`    - ${k}: ${v}`);
        }
      }
      if (check.error) {
        console.log(`    - Error: ${check.error}`);
      }
    }

    console.log('\n====================================================\n');

    await prismaService.disconnect();

    // If configuration or system is down, exit with code 1
    if (report.status === 'down') {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    logger.error({ err }, '[HealthCheck] Failed unexpectedly');
    console.error('\n❌ Health check encountered a fatal error:', err);
    await prismaService.disconnect();
    process.exit(1);
  }
}

runHealthCheck();
