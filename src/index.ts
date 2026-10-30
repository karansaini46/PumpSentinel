import { configService } from './modules/configuration/index.js';
import { logger } from './modules/observability/index.js';
import { healthService } from './modules/observability/index.js';
import { prismaService } from './modules/persistence/index.js';
import { ingestionStreamService } from './modules/ingestion/index.js';
import { discoveryService } from './modules/discovery/index.js';
import { riskService, portfolioRiskController } from './modules/risk/index.js';
import { portfolioService } from './modules/portfolio/index.js';
import { notificationsService } from './modules/notifications/index.js';
import { telegramBotService } from './modules/telegram/index.js';
import { tokenAnalysisService } from './modules/analysis/index.js';
import { systemStateService } from './modules/system-state/index.js';

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

  healthService.registerCheck('portfolio_risk', async () => {
    const metrics = portfolioRiskController.getEquityMetrics();
    const pause = portfolioRiskController.getPauseDetails();
    return {
      status: pause.isPaused ? 'degraded' : 'ok',
      details: {
        isPaused: pause.isPaused,
        pauseReason: pause.reason,
        totalEquitySol: metrics.totalEquitySol,
        cashBalanceSol: metrics.cashBalanceSol,
        openPositionsCount: metrics.openPositionsCount,
        drawdownPct: metrics.currentDrawdownPct,
        dailyLossPct: metrics.dailyLossPct,
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

  // Stage 1: Discovered On-Chain (Event 1: Newly Discovered Tokens)
  discoveryService.onTokenDiscoveredOnChain(async (token) => {
    await notificationsService.notifyTokenDiscovered({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      discoveryTimestamp: token.discoveredAt,
      creator: token.creator,
      liquiditySol: token.initialLiquiditySol,
      dataFreshnessMs: token.discoveryLatencyMs,
      decision: 'DISCOVERED',
      decisionReason: `Discovered on-chain at slot ${token.slot}`,
      marketDataSource: token.source,
      isSynthetic: token.isSynthetic,
      slot: token.slot,
    });
  });

  // Stage 3: Eligible for Risk Analysis (Events 2 & 3: Risk Rejection & Strategy Eligible)
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

      const gateDecision = riskService.evaluateGate({
        mint: token.mint,
        symbol: token.symbol,
        riskReport: comprehensiveReport,
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
          gateOutcome: gateDecision.outcome,
          gatePassed: gateDecision.passed,
          gateDecisionId: gateDecision.decisionId,
          summary: comprehensiveReport.summary,
          metadataStatus: token.metadataStatus,
          completenessPct: analysisReport.overallSummary.dataCompletenessPct,
        },
        '[DiscoveryService] Token analyzed, assessed for risk & gate evaluated',
      );

      // Event 2: Risk Rejection alert
      if (gateDecision.outcome === 'REJECT') {
        await notificationsService.notifyRiskRejected({
          mint: token.mint,
          symbol: token.symbol,
          name: token.name,
          discoveryTimestamp: token.discoveredAt,
          creator: token.creator,
          liquiditySol: token.initialLiquiditySol,
          dataFreshnessMs: token.discoveryLatencyMs,
          riskScore: comprehensiveReport.overallScore,
          riskSummary: comprehensiveReport.summary,
          decision: 'REJECT',
          decisionReason: gateDecision.reasons.join('; ') || 'Risk gate rejected token',
          marketDataSource: token.source,
          isSynthetic: token.isSynthetic,
          slot: token.slot,
        });
      } else if (gateDecision.outcome === 'ELIGIBLE_FOR_STRATEGY') {
        // Event 3: Strategy Eligible alert
        await notificationsService.notifyStrategyEligible({
          mint: token.mint,
          symbol: token.symbol,
          name: token.name,
          discoveryTimestamp: token.discoveredAt,
          creator: token.creator,
          liquiditySol: token.initialLiquiditySol,
          dataFreshnessMs: token.discoveryLatencyMs,
          riskScore: comprehensiveReport.overallScore,
          riskSummary: comprehensiveReport.summary,
          decision: 'ELIGIBLE_FOR_STRATEGY',
          decisionReason: 'Passed all deterministic safety and liquidity requirements',
          marketDataSource: token.source,
          isSynthetic: token.isSynthetic,
          slot: token.slot,
        });
      }
    } catch (err) {
      logger.warn({ mint: token.mint, err }, '[DiscoveryService] Error analyzing token for risk');
    }
  });

  // Events 4, 5, 6, 7, 8: Simulated Trades (Buy, Sell, Stop-Loss, Take-Profit, Emergency Exit)
  portfolioService.onTrade(async (trade, position, pnlSol) => {
    if (trade.side === 'BUY') {
      await notificationsService.notifySimulatedBuy({
        tradeId: trade.tradeId,
        tokenMint: trade.tokenMint,
        tokenSymbol: trade.tokenSymbol,
        side: 'BUY',
        stage: 'FILLED',
        executedPriceSol: trade.executedPriceSol,
        amountTokens: trade.amountTokens,
        totalSol: trade.totalSol,
        simulatedFeeSol: trade.simulatedFeeSol,
        slippageBps: trade.slippageBpsApplied,
        unrealizedPnlSol: 0,
        unrealizedPnlPct: 0,
        executedAt: trade.executedAt,
      });
    } else {
      const reasonLower = (trade.reason ?? '').toLowerCase();
      const pnlPct =
        position && position.solInvested > 0 && pnlSol !== undefined
          ? (pnlSol / position.solInvested) * 100
          : undefined;

      const tradePayload = {
        tradeId: trade.tradeId,
        tokenMint: trade.tokenMint,
        tokenSymbol: trade.tokenSymbol,
        side: 'SELL' as const,
        stage: 'FILLED' as const,
        entryPriceSol: position?.entryPriceSol,
        executedPriceSol: trade.executedPriceSol,
        amountTokens: trade.amountTokens,
        totalSol: trade.totalSol,
        simulatedFeeSol: trade.simulatedFeeSol,
        slippageBps: trade.slippageBpsApplied,
        realizedPnlSol: pnlSol,
        realizedPnlPct: pnlPct,
        exitReason: trade.reason,
        executedAt: trade.executedAt,
      };

      if (reasonLower.includes('emergency') || reasonLower.includes('exit_pending')) {
        await notificationsService.notifyEmergencyExit(tradePayload);
      } else if (reasonLower.includes('stop-loss') || reasonLower.includes('stop loss')) {
        await notificationsService.notifyStopLossTriggered(tradePayload);
      } else if (reasonLower.includes('take-profit') || reasonLower.includes('take profit')) {
        await notificationsService.notifyTakeProfitTriggered(tradePayload);
      } else {
        await notificationsService.notifySimulatedSell(tradePayload);
      }
    }
  });

  // Attempt DB connection gracefully
  try {
    await prismaService.connect();
  } catch (err) {
    logger.warn({ err }, 'PostgreSQL is offline. Application will operate with in-memory caching.');
  }

  // Initialize portfolio-risk controller & perform reconciliation
  await portfolioRiskController.initialize();

  // Initialize explicit system operating state across restarts (Requirement 11)
  await systemStateService.init();

  // Start Ingestion stream only if not in STOPPED state
  if (systemStateService.getState() !== 'STOPPED') {
    await ingestionStreamService.start();
  } else {
    logger.info('[Bootstrap] Ingestion stream remaining STOPPED per persisted operating state');
  }

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

  // Graceful shutdown handling with re-entry guard and forced termination timeout
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress. Ignoring duplicate signal.');
      return;
    }
    isShuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received. Cleaning up resources cleanly...');

    // Force terminate after 10 seconds if any handle fails to release
    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 10s. Forcing exit.');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      // 1. Drain & stop notification queues
      notificationsService.getQueue().stop();

      // 2. Stop WebSocket / polling ingestion stream
      await ingestionStreamService.stop();

      // 3. Stop Telegram Bot polling / webhook listener
      await telegramBotService.stop();

      // 4. Disconnect Prisma PostgreSQL connection pool
      await prismaService.disconnect();

      clearTimeout(forceExitTimer);
      logger.info('PumpSentinel terminated cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown sequence');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise Rejection detected');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught Exception detected. Initiating emergency shutdown.');
    shutdown('UNCAUGHT_EXCEPTION').catch(() => process.exit(1));
  });

  logger.info('🛡️ PumpSentinel is active and monitoring.');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during PumpSentinel bootstrap');
  process.exit(1);
});
