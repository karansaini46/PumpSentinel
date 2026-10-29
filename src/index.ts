import { configService } from './modules/configuration/index.js';
import { logger } from './modules/observability/index.js';
import { healthService } from './modules/observability/index.js';
import { prismaService } from './modules/persistence/index.js';
import { ingestionStreamService } from './modules/ingestion/index.js';
import { discoveryService } from './modules/discovery/index.js';
import { riskService } from './modules/risk/index.js';
import { notificationsService } from './modules/notifications/index.js';
import { telegramBotService } from './modules/telegram/index.js';
import { tokenAnalysisService } from './modules/analysis/index.js';

async function bootstrap(): Promise<void> {
  logger.info('====================================================');
  logger.info('   🛡️  PumpSentinel Solana Bot - Initializing   ');
  logger.info('   Mode: Strictly Simulated Paper-Trading Only      ');
  logger.info('====================================================');

  const config = configService.getAll();
  logger.info({ env: config.NODE_ENV, logLevel: config.LOG_LEVEL }, 'Configuration loaded');

  // Register notification channel
  notificationsService.registerChannel(telegramBotService);

  // Setup subsystem health probes
  healthService.registerCheck('database', async () => {
    const isAlive = await prismaService.ping();
    return {
      status: isAlive ? 'ok' : 'degraded',
      details: { connected: isAlive },
    };
  });

  healthService.registerCheck('ingestion_stream', async () => {
    const health = ingestionStreamService.getHealth();
    return {
      status: health.status === 'ERROR' ? 'down' : 'ok',
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

  // Initialize discovery cursor from PostgreSQL to resume processing after restarts
  await discoveryService.init();

  // Wire ingestion stream to discovery
  ingestionStreamService.onEvent(async (event) => {
    if (event.type === 'TOKEN_CREATED') {
      await discoveryService.processTokenCreation(event);
    }
  });

  // Stage 1: Discovered On-Chain
  discoveryService.onTokenDiscoveredOnChain(async (token) => {
    const label = token.isSynthetic ? '[SYNTHETIC]' : '[ON-CHAIN]';
    await notificationsService.notify(
      'TOKEN_DISCOVERY',
      `${label} Discovered: ${token.symbol}`,
      `• Mint: \`${token.mint}\`\n• Creator: \`${token.creator}\`\n• Slot: ${token.slot}\n• Latency: ${token.discoveryLatencyMs}ms\n• Source: ${token.source}`,
      'LOW',
    );
  });

  // Stage 3: Eligible for Risk Analysis
  discoveryService.onTokenEligibleForRisk(async (token, meta) => {
    try {
      const analysisReport = await tokenAnalysisService.analyzeToken(token.mint, {
        creatorAddress: token.creator,
        bondingCurveAddress: token.bondingCurve,
        initialLiquiditySol: token.initialLiquiditySol,
        isSynthetic: token.isSynthetic,
      });

      const top10 =
        typeof analysisReport.largestHolders.nonCurveTop10Percentage.value === 'number'
          ? analysisReport.largestHolders.nonCurveTop10Percentage.value
          : 20.0;
      const devHold =
        typeof analysisReport.creatorHoldings.percentageOfSupply.value === 'number'
          ? analysisReport.creatorHoldings.percentageOfSupply.value
          : 5.0;

      const riskAssessment = riskService.assess({
        mint: token.mint,
        symbol: token.symbol,
        liquiditySol: token.initialLiquiditySol,
        top10HoldingPct: top10,
        devHoldingPct: devHold,
        hasValidMetadata: token.metadataStatus === 'RESOLVED',
        hasSocials: Boolean(
          (meta as { socials?: { twitter?: string; telegram?: string } })?.socials?.twitter,
        ),
        suspectedSniperCount: analysisReport.relatedWallets.hasSybilCluster.value === true ? 4 : 0,
      });

      const comprehensiveReport = riskService.evaluateComprehensive({
        mint: token.mint,
        symbol: token.symbol,
        analysisReport,
        customLiquiditySol: token.initialLiquiditySol,
      });

      logger.info(
        {
          mint: token.mint,
          legacyScore: riskAssessment.score,
          legacyPassed: riskAssessment.passed,
          deterministicStatus: comprehensiveReport.overallStatus,
          deterministicScore: comprehensiveReport.overallScore,
          deterministicPassed: comprehensiveReport.passed,
          summary: comprehensiveReport.summary,
          metadataStatus: token.metadataStatus,
          completenessPct: analysisReport.overallSummary.dataCompletenessPct,
        },
        '[DiscoveryService] Token analyzed & assessed for risk',
      );
    } catch (err) {
      logger.warn({ mint: token.mint, err }, '[DiscoveryService] Error analyzing token for risk');
    }
  });

  // Attempt DB connection gracefully
  try {
    await prismaService.connect();
  } catch (err) {
    logger.warn({ err }, 'PostgreSQL is offline. Application will operate with in-memory caching.');
  }

  // Start Ingestion stream
  await ingestionStreamService.start();

  // Start Telegram Bot if token is provided
  if (config.TELEGRAM_BOT_TOKEN && !config.TELEGRAM_BOT_TOKEN.includes('example')) {
    try {
      telegramBotService.initialize();
      await telegramBotService.start();
    } catch (err) {
      logger.error({ err }, 'Failed to start Telegram Bot');
    }
  } else {
    logger.info(
      'Telegram bot running in mock/offline mode (set a valid TELEGRAM_BOT_TOKEN in .env to connect live)',
    );
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received. Cleaning up resources...');
    await ingestionStreamService.stop();
    await telegramBotService.stop();
    await prismaService.disconnect();
    logger.info('PumpSentinel terminated cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('🛡️ PumpSentinel is active and monitoring.');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during PumpSentinel bootstrap');
  process.exit(1);
});
