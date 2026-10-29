#!/usr/bin/env node
import { discoveryService } from '../modules/discovery/discovery.service.js';
import { replayService } from '../modules/discovery/replay.service.js';
import { prismaService } from '../modules/persistence/prisma.service.js';
import { logger } from '../modules/observability/logger.js';

async function main(): Promise<void> {
  console.log('====================================================');
  console.log('   🛡️  PumpSentinel - Development Replay Mode     ');
  console.log('   Processing recorded / synthetic fixtures        ');
  console.log('====================================================\n');

  // Attempt database connection
  try {
    await prismaService.connect();
    console.log('✓ Connected to PostgreSQL database.');
  } catch {
    console.log('ℹ Running with in-memory persistence (PostgreSQL offline).');
  }

  // Initialize cursor from DB
  await discoveryService.init();

  // Attach listeners for all 3 lifecycle stages
  discoveryService.onTokenDiscoveredOnChain((token) => {
    console.log(
      `[1/3 ON-CHAIN] Discovered: ${token.symbol} (${token.name}) | Mint: ${token.mint} | Synthetic: ${token.isSynthetic} | Latency: ${token.discoveryLatencyMs}ms`,
    );
  });

  discoveryService.onTokenMetadataRetrieved((token, _meta) => {
    console.log(
      `[2/3 METADATA] Resolved: ${token.symbol} | Status: ${token.metadataStatus} | URI: ${token.uri || '(none)'}`,
    );
  });

  discoveryService.onTokenEligibleForRisk((token, _meta) => {
    console.log(
      `[3/3 ELIGIBLE] Ready for Risk Engine: ${token.symbol} | State: ${token.lifecycleState} | Initial Liquidity: ${token.initialLiquiditySol} SOL\n`,
    );
  });

  // Execute replay
  const count = await replayService.replay({
    intervalMs: 150, // 150ms between events for visual clarity
    onEvent: async (event) => {
      await discoveryService.processTokenCreation(event);
    },
  });

  const stats = discoveryService.getStats();
  const cursor = discoveryService.getCursor();

  console.log('----------------------------------------------------');
  console.log('📊 Replay Summary & Discovery Statistics:');
  console.log(`• Total Replayed:          ${count}`);
  console.log(`• Total Discovered:        ${stats.totalDiscovered}`);
  console.log(`• Synthetic Count:         ${stats.syntheticCount} (Explicitly labeled)`);
  console.log(`• Metadata Resolved:       ${stats.metadataResolvedCount}`);
  console.log(`• Eligible for Risk:       ${stats.eligibleCount}`);
  console.log(`• Duplicates Blocked:      ${stats.duplicateCount}`);
  console.log(`• Processing Failures:     ${stats.processingFailuresCount}`);
  console.log(`• Avg Discovery Latency:   ${stats.averageDiscoveryLatencyMs}ms`);
  console.log(`• Watermark Slot:          ${cursor.lastSlot}`);
  console.log(`• Watermark Signature:     ${cursor.lastSignature}`);
  console.log('----------------------------------------------------\n');

  await prismaService.disconnect().catch(() => {});
  logger.info('[ReplayScript] Development replay finished successfully.');
}

main().catch((err) => {
  console.error('Fatal error during replay:', err);
  process.exit(1);
});
