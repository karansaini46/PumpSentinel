import type { CommandDefinition, TelegramCommandContext } from './telegram.types.js';
import {
  InspectCommandSchema,
  PaginationSchema,
  TopCommandSchema,
  HistoryCommandSchema,
  SetCommandSchema,
  ConfirmCommandSchema,
} from './telegram.types.js';
import { systemStateService, ConfigValueValidators } from '../system-state/index.js';
import {
  escapeHtml,
  sanitizeSecrets,
  paginateArray,
  shortenAddress,
  formatSol,
  formatUsd,
  formatPct,
} from './telegram-utils.js';
import { healthService } from '../observability/health.service.js';
import { portfolioService } from '../portfolio/portfolio.service.js';
import { portfolioRiskController } from '../risk/portfolio-risk-controller.js';
import { discoveryService } from '../discovery/discovery.service.js';
import { ingestionStreamService } from '../ingestion/stream.service.js';
import { strategyService } from '../strategy/strategy.service.js';
import { riskService } from '../risk/risk.service.js';
import { tokenAnalysisService } from '../analysis/index.js';
import { paperTradingRepository } from '../persistence/paper-trading.repository.js';
import { configService } from '../configuration/config.service.js';
import { logger } from '../observability/logger.js';

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();

  constructor() {
    this.registerDefaults();
  }

  public register(cmd: CommandDefinition): void {
    this.commands.set(cmd.command.toLowerCase(), cmd);
  }

  public getCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  public getCommand(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase());
  }

  private registerDefaults(): void {
    // =========================================================================
    // 1. /start
    // =========================================================================
    this.register({
      command: 'start',
      description: 'Welcome to PumpSentinel and safety overview',
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const text = [
          '🛡️ <b>PumpSentinel Solana Sentinel Online</b>',
          '',
          'Automated Solana pump.fun token monitor &amp; independent portfolio-risk controller.',
          '',
          '🔒 <b>Operating Mode:</b>',
          '• <b>Mode:</b> Strictly Simulated Paper-Trading Only.',
          '• <b>Zero Real Funds:</b> Real wallet private keys are strictly forbidden and never touched.',
          '• <b>Hardware:</b> Tuned for resource-constrained 8 GB RAM Linux hosts.',
          '',
          'Type /help to view all available commands or /status to check monitoring.',
        ].join('\n');
        await replyHtml(text);
      },
    });

    // =========================================================================
    // 2. /help
    // =========================================================================
    this.register({
      command: 'help',
      description: 'List available commands and descriptions',
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const text = [
          '📋 <b>PumpSentinel Command Reference:</b>',
          '',
          '<b>🛡️ State Machine &amp; Controls (Sensitive):</b>',
          '• /status — Operating state (STOPPED/MONITORING/PAUSED/ERROR), stream &amp; risk',
          '• /pause — Immediately engage global trading pause (blocks new positions)',
          '• /resume — Resume monitoring and entries (requires healthy data &amp; valid config)',
          '• /stop — Stop monitoring stream and new entries (positions remain protected)',
          '',
          '<b>⚙️ Configuration &amp; Safety (Sensitive):</b>',
          '• /settings — View current risk limits, strategy bounds &amp; configurable parameters',
          '• /set &lt;param&gt; &lt;val&gt; — Propose a validated configuration change (requires confirmation)',
          '• /confirm &lt;token&gt; — Confirm and apply a proposed configuration change',
          '• /cancel — Cancel any pending configuration changes',
          '',
          '<b>💼 Portfolio &amp; PnL:</b>',
          '• /paper — Paper-trading engine status &amp; strategy parameters',
          '• /balance — Virtual cash balance, total equity &amp; drawdown metrics',
          '• /pnl — Realized &amp; unrealized P&amp;L, win rate &amp; trade counts',
          '• /positions [page] — Active paper positions &amp; EXIT_PENDING status',
          '• /history [page] — Historical paper-trading ledger fills',
          '',
          '<b>🔍 Market &amp; Inspection:</b>',
          '• /top [limit] — Top recently discovered pump.fun tokens',
          '• /inspect &lt;address&gt; — Deep token analysis, authorities &amp; risk evaluation',
          '• /health — System uptime, RAM usage &amp; subsystem health probes',
          '',
          'ℹ️ <i>Sensitive commands require authorized Telegram user-ID verification. Real-money trading is strictly forbidden.</i>',
        ].join('\n');
        await replyHtml(text);
      },
    });

    // =========================================================================
    // 3. /status
    // =========================================================================
    this.register({
      command: 'status',
      description: 'Operating mode, state machine, ingestion stream, and discovery metrics',
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const state = systemStateService.getState();
        const lastTrans = systemStateService.getLastTransition();
        const streamMetrics = ingestionStreamService.getMetrics();
        const streamHealth = ingestionStreamService.getHealth();
        const discStats = discoveryService.getStats();
        const pauseDetails = portfolioRiskController.getPauseDetails();
        const openPositions = portfolioService.getOpenPositions();
        const pendingExits = portfolioRiskController.getExitPendingPositions();

        const stateIcon =
          state === 'MONITORING'
            ? '🟢'
            : state === 'PAUSED'
              ? '🛑'
              : state === 'STOPPED'
                ? '⚪'
                : '🔴';
        const streamIcon = streamMetrics.status === 'CONNECTED' ? '🟢' : '🔴';

        // Position monitoring policy definition (Requirement 5)
        const positionPolicy =
          state === 'STOPPED'
            ? '<b>PROTECTED DORMANT:</b> Existing paper positions remain guarded by stop-loss, take-profit & holding-time exits.'
            : state === 'PAUSED'
              ? '<b>ACTIVE DORMANT:</b> Global entries paused; active positions monitor and execute exits normally.'
              : '<b>FULL MONITORING:</b> Active risk management, dynamic trailing and exit triggers engaged.';

        const recentRejections = riskService.getGate().getRecentRejections(3);
        const rejectionRows =
          recentRejections.length > 0
            ? recentRejections.map(
                (r) =>
                  `• <code>${shortenAddress(r.tokenMint)}</code> (${escapeHtml(r.tokenSymbol)}): ${escapeHtml(r.reasons[0] ?? 'Failed risk rule')}`,
              )
            : ['• None recorded (All evaluated tokens clean)'];

        const lastTransText = lastTrans
          ? `• Last State Transition: <code>${lastTrans.fromState}</code> ➔ <b>${lastTrans.toState}</b> (${lastTrans.timestamp.toISOString().replace('T', ' ').slice(0, 19)} UTC by ${lastTrans.triggeredBy.username ?? lastTrans.triggeredBy.userId})`
          : '• Last State Transition: Initial Boot';

        const text = [
          '📊 <b>PumpSentinel System Status</b>',
          '• Operating Mode: <b>STRICTLY_SIMULATED_PAPER_TRADING</b>',
          '',
          '<b>⚙️ Explicit Operating State:</b>',
          `• System State: ${stateIcon} <b>${state}</b>`,
          `• Global Trading Entries: <b>${pauseDetails.isPaused || state !== 'MONITORING' ? 'BLOCKED' : 'ACTIVE'}</b>`,
          `• Ingestion Stream: <b>${streamMetrics.status}</b> (${streamHealth.latencyMs}ms latency)`,
          `• Position Safety Policy: ${positionPolicy}`,
          lastTransText,
          pauseDetails.isPaused
            ? `  <i>Pause Details: ${escapeHtml(pauseDetails.reason ?? 'N/A')} (${pauseDetails.trigger ?? 'MANUAL'})</i>`
            : '',
          '',
          '<b>🔌 Data-Provider Health &amp; Ingestion:</b>',
          `• Stream Provider: ${streamIcon} <b>${escapeHtml(streamMetrics.status)}</b> (Endpoint: <code>${escapeHtml(streamHealth.sanitizedEndpoint)}</code>)`,
          `• Events Ingested: <b>${streamMetrics.eventsIngested.toLocaleString()}</b> | Reconnects: ${streamHealth.reconnectCount}`,
          `• Duplicates Dropped: ${streamMetrics.duplicatesPrevented.toLocaleString()}`,
          '',
          '<b>🔍 Token Discovery:</b>',
          `• Total Discovered: <b>${discStats.totalDiscovered.toLocaleString()}</b> | Active Cache: <b>${discStats.activeCacheSize}</b>`,
          `• Last Slot: ${discStats.lastProcessedSlot.toLocaleString()} (Avg Latency: ${discStats.averageDiscoveryLatencyMs}ms)`,
          '',
          '<b>🛡️ Recent Risk Rejections:</b>',
          ...rejectionRows,
          '',
          '<b>💼 Portfolio Snapshot:</b>',
          `• Open Positions: <b>${openPositions.length}</b>`,
          pendingExits.length > 0
            ? `• 🚨 <b>Exit Pending:</b> <b>${pendingExits.length}</b> (Requires attention)`
            : '• Exit Pending: 0',
        ]
          .filter(Boolean)
          .join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 4. /paper
    // =========================================================================
    this.register({
      command: 'paper',
      description: 'Paper-trading strategy settings and execution controls',
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const stratConfig = strategyService.getConfig();
        const riskConfig = portfolioRiskController.getConfig();
        const summary = portfolioService.getSummary();
        const pauseDetails = portfolioRiskController.getPauseDetails();

        const autoIcon = stratConfig.autoTradeEnabled ? '🟢' : '⚪';
        const pauseIcon = pauseDetails.isPaused ? '🛑' : '🟢';

        const text = [
          '📝 <b>Simulated Paper-Trading Controls</b>',
          '',
          `• Mode: <code>SIMULATED_EXECUTION_ONLY</code>`,
          `• Strategy Auto-Trade: ${autoIcon} <b>${stratConfig.autoTradeEnabled ? 'ENABLED' : 'DISABLED'}</b>`,
          `• Trading Gate: ${pauseIcon} <b>${pauseDetails.isPaused ? 'PAUSED (Buys Blocked)' : 'ACTIVE'}</b>`,
          '',
          '<b>🎯 Strategy Execution Bounds:</b>',
          `• Fixed Buy Size: <b>${stratConfig.fixedBuyAmountSol} SOL</b> ($${formatUsd(stratConfig.fixedBuyAmountSol * riskConfig.solPriceUsd)})`,
          `• Take-Profit Target: <b>+${riskConfig.takeProfitPct}%</b>`,
          `• Stop-Loss Threshold: <b>-${riskConfig.stopLossPct}%</b> <i>(Non-guaranteed)</i>`,
          `• Max Holding Time: <b>${Math.round(riskConfig.maxHoldingDurationMs / 1000)}s</b> (${Math.round(riskConfig.maxHoldingDurationMs / 60000)}m)`,
          `• Max Open Positions: <b>${riskConfig.maxConcurrentPositions}</b>`,
          '',
          '<b>💰 Available Capital:</b>',
          `• Cash Balance: <b>${formatSol(summary.currentSolBalance)} SOL</b> ($${formatUsd(summary.currentCashBalanceUsd)})`,
          `• Total Trades Replayed: ${summary.totalTrades}`,
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 5. /pause (Sensitive) - Requirement 2
    // =========================================================================
    this.register({
      command: 'pause',
      description: 'Immediately engage global trading pause (blocks new positions)',
      isSensitive: true,
      handler: async ({ replyHtml, userId, username }: TelegramCommandContext) => {
        const res = await systemStateService.pause(userId, username);

        if (res.duplicate) {
          await replyHtml(`ℹ️ <b>System is already in PAUSED state.</b> No change was made.`);
          return;
        }

        if (!res.success) {
          await replyHtml(
            `❌ <b>Failed to pause:</b> ${escapeHtml(res.message || res.error || 'Unknown error')}`,
          );
          return;
        }

        const text = [
          '🛑 <b>Global Trading Pause Engaged</b>',
          '',
          `• <b>Operating State:</b> <code>PAUSED</code>`,
          `• <b>Operator:</b> <code>${escapeHtml(username ?? String(userId))}</code>`,
          '• <b>Trigger:</b> <code>MANUAL</code>',
          '• <b>Policy:</b> All new simulated positions are <b>immediately blocked</b>.',
          '• <b>Exits:</b> Existing open positions continue to be monitored and can exit normally.',
          '',
          'Use /resume to resume global trading and entries.',
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 6. /resume (Sensitive) - Requirement 3
    // =========================================================================
    this.register({
      command: 'resume',
      description: 'Resume global operations (requires healthy data sources & valid risk config)',
      isSensitive: true,
      handler: async ({ replyHtml, userId, username }: TelegramCommandContext) => {
        const res = await systemStateService.resume(userId, username);

        if (res.duplicate) {
          await replyHtml(`ℹ️ <b>System is already in MONITORING state.</b> No change was made.`);
          return;
        }

        if (!res.success) {
          await replyHtml(res.message);
          return;
        }

        const text = [
          '✅ <b>Global Trading Resumed</b>',
          '',
          `• <b>Operating State:</b> <code>MONITORING</code>`,
          `• <b>Operator:</b> <code>${escapeHtml(username ?? String(userId))}</code>`,
          '• <b>Preconditions:</b> Data sources verified healthy &amp; risk configuration validated.',
          '• <b>Policy:</b> Ingestion stream active and new position entries are <b>unblocked</b>.',
          '',
          'Type /status to verify trading activity.',
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 6b. /stop (Sensitive) - Requirements 4 & 5
    // =========================================================================
    this.register({
      command: 'stop',
      description: 'Stop monitoring stream and new entries (existing positions remain protected)',
      isSensitive: true,
      handler: async ({ replyHtml, userId, username }: TelegramCommandContext) => {
        const res = await systemStateService.stop(userId, username);

        if (res.duplicate) {
          await replyHtml(`ℹ️ <b>System is already in STOPPED state.</b> No change was made.`);
          return;
        }

        if (!res.success) {
          await replyHtml(
            `❌ <b>Failed to stop:</b> ${escapeHtml(res.message || res.error || 'Unknown error')}`,
          );
          return;
        }

        const text = [
          '⚪ <b>System Operating State: STOPPED</b>',
          '',
          `• <b>Operating State:</b> <code>STOPPED</code>`,
          `• <b>Operator:</b> <code>${escapeHtml(username ?? String(userId))}</code>`,
          '• <b>Ingestion Stream:</b> <b>STOPPED</b> (New token discovery halted).',
          '• <b>New Entries:</b> <b>STRICTLY BLOCKED</b>.',
          '• <b>Existing Paper Positions:</b> <b>PROTECTED &amp; MONITORED</b> (Stop-loss, take-profit, and max holding time exit bounds remain active to safeguard virtual equity).',
          '',
          'Use /resume to restart monitoring and trading.',
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 7. /positions [page]
    // =========================================================================
    this.register({
      command: 'positions',
      description: 'List active open paper positions and EXIT_PENDING tokens',
      handler: async ({ replyHtml, args }: TelegramCommandContext) => {
        const parseRes = PaginationSchema.safeParse({ page: args[0] });
        if (args[0] !== undefined && !parseRes.success) {
          await replyHtml(
            '❌ <b>Invalid Command Argument:</b>\nPage number must be a positive integer (e.g., <code>/positions 2</code>).',
          );
          return;
        }
        const page = parseRes.success ? parseRes.data.page : 1;

        const openPositions = portfolioService.getOpenPositions();
        const pendingExits = portfolioRiskController.getExitPendingPositions();

        if (openPositions.length === 0 && pendingExits.length === 0) {
          await replyHtml('ℹ️ <b>No active positions or pending exits</b> in simulated portfolio.');
          return;
        }

        const pageSize = 4;
        const pagination = paginateArray(openPositions, page, pageSize);
        const riskConfig = portfolioRiskController.getConfig();
        const nowMs = Date.now();

        const positionBlocks = pagination.items.map((pos, idx) => {
          const globalIdx = (pagination.page - 1) * pageSize + idx + 1;
          const pnlSol = pos.unrealizedPnlSol;
          const pnlPct = pos.unrealizedPnlPercent;
          const pnlIcon = pnlSol >= 0 ? '🟢' : '🔴';

          const holdingDurationMs = nowMs - pos.openedAt.getTime();
          const holdingSecs = Math.round(holdingDurationMs / 1000);
          const maxSecs = Math.round(riskConfig.maxHoldingDurationMs / 1000);

          const isExitPending = pos.status === 'EXIT_PENDING';
          const statusBadge = isExitPending ? '🚨 <b>EXIT_PENDING</b>' : '🟢 <b>OPEN</b>';

          return [
            `${globalIdx}. <b>${escapeHtml(pos.tokenSymbol)}</b> — ${statusBadge}`,
            `   • Mint: <code>${pos.tokenMint}</code>`,
            `   • Tokens: <b>${pos.amountTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>`,
            `   • Entry: <code>${formatSol(pos.entryPriceSol)} SOL</code> ($${formatUsd(pos.entryPriceUsd)})`,
            `   • Current: <code>${formatSol(pos.currentPriceSol)} SOL</code> ($${formatUsd(pos.currentPriceUsd)})`,
            `   • Invested: <b>${formatSol(pos.solInvested)} SOL</b> ($${formatUsd(pos.usdInvested)})`,
            `   • Unrealized PnL: ${pnlIcon} <b>${formatSol(pnlSol)} SOL</b> (${formatPct(pnlPct)})`,
            `   • Holding Time: <b>${holdingSecs}s / ${maxSecs}s</b>`,
            isExitPending && pos.exitPendingDetails
              ? `   ⚠️ <i>Exit Failure: ${escapeHtml(pos.exitPendingDetails.failureReason)}</i>`
              : '',
          ]
            .filter(Boolean)
            .join('\n');
        });

        const pendingNotice =
          pendingExits.length > 0
            ? `\n🚨 <b>Alert: ${pendingExits.length} position(s) marked EXIT_PENDING!</b> Check pool liquidity.`
            : '';

        const text = [
          `💼 <b>Open Simulated Positions (${openPositions.length})</b> — Page ${pagination.page}/${pagination.totalPages}:`,
          '',
          positionBlocks.join('\n\n'),
          '',
          pagination.totalPages > 1
            ? `<i>Navigate with: /positions &lt;page&gt; (e.g. /positions ${pagination.page + 1})</i>`
            : '',
          pendingNotice,
        ]
          .filter(Boolean)
          .join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 8. /balance
    // =========================================================================
    this.register({
      command: 'balance',
      description: 'View virtual cash balance, total equity, and drawdown metrics',
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const metrics = portfolioRiskController.getEquityMetrics();
        const riskConfig = portfolioRiskController.getConfig();

        const drawdownIcon = metrics.currentDrawdownPct >= riskConfig.maxDrawdownPct ? '🔴' : '🟢';
        const dailyLossIcon = metrics.dailyLossPct >= riskConfig.maxDailyLossPct ? '🔴' : '🟢';

        const text = [
          '💰 <b>Simulated Virtual Portfolio Balance</b>',
          '',
          '<b>💵 Capital Breakdown:</b>',
          `• Available Cash: <b>${formatSol(metrics.cashBalanceSol)} SOL</b> ($${formatUsd(metrics.cashBalanceUsd)})`,
          `• Open Positions Value: <b>${formatSol(metrics.openPositionsValueSol)} SOL</b> ($${formatUsd(metrics.openPositionsValueUsd)})`,
          `• Total Portfolio Equity: <b>${formatSol(metrics.totalEquitySol)} SOL</b> ($${formatUsd(metrics.totalEquityUsd)})`,
          `• Starting Daily Equity: ${formatSol(metrics.dailyStartingEquitySol)} SOL ($${formatUsd(metrics.dailyStartingEquityUsd)})`,
          `• Peak Equity (High-Water): <b>${formatSol(metrics.peakEquitySol)} SOL</b> ($${formatUsd(metrics.peakEquityUsd)})`,
          '',
          '<b>🛡️ Risk &amp; Drawdown Limits:</b>',
          `• Current Drawdown: ${drawdownIcon} <b>${metrics.currentDrawdownPct.toFixed(2)}%</b> (Max limit: ${riskConfig.maxDrawdownPct}%)`,
          `• Daily Loss: ${dailyLossIcon} <b>${metrics.dailyLossPct.toFixed(2)}%</b> (Max limit: ${riskConfig.maxDailyLossPct}%)`,
          `• Total Exposure: <b>${formatSol(metrics.totalExposureSol)} SOL</b> (${metrics.totalExposurePct.toFixed(1)}% / ${riskConfig.maxTotalExposurePct}% max)`,
          `• Open Positions: ${metrics.openPositionsCount} / ${riskConfig.maxConcurrentPositions} max`,
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 9. /pnl
    // =========================================================================
    this.register({
      command: 'pnl',
      description: 'Detailed realized and unrealized P&L breakdown',
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const s = portfolioService.getSummary();
        const totalPnlIcon = s.totalPnlSol >= 0 ? '🟢' : '🔴';
        const realizedIcon = s.realizedPnlSol >= 0 ? '🟢' : '🔴';
        const unrealizedIcon = s.unrealizedPnlSol >= 0 ? '🟢' : '🔴';

        const text = [
          '📈 <b>Simulated Portfolio P&amp;L Report</b>',
          '',
          '<b>📊 Profit &amp; Loss Breakdown:</b>',
          `• Total Combined PnL: ${totalPnlIcon} <b>${s.totalPnlSol > 0 ? '+' : ''}${formatSol(s.totalPnlSol)} SOL</b> ($${s.totalPnlUsd > 0 ? '+' : ''}${formatUsd(s.totalPnlUsd)})`,
          `• Total Return: <b>${formatPct(s.totalPnlPercent)}</b>`,
          `• Realized PnL: ${realizedIcon} <b>${s.realizedPnlSol > 0 ? '+' : ''}${formatSol(s.realizedPnlSol)} SOL</b> ($${formatUsd(s.realizedPnlUsd)})`,
          `• Unrealized PnL: ${unrealizedIcon} <b>${s.unrealizedPnlSol > 0 ? '+' : ''}${formatSol(s.unrealizedPnlSol)} SOL</b> ($${formatUsd(s.unrealizedPnlUsd)})`,
          `• Simulated Fees Paid: <code>${formatSol(s.totalFeesPaidSol)} SOL</code> ($${formatUsd(s.totalFeesPaidUsd)})`,
          '',
          '<b>🏆 Trading Performance:</b>',
          `• Total Trades: <b>${s.totalTrades}</b>`,
          `• Wins: <b>${s.winCount}</b> | Losses: <b>${s.lossCount}</b>`,
          `• Win Rate: <b>${s.winRatePercent.toFixed(1)}%</b>`,
          `• Active Positions: ${s.openPositionsCount}`,
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 10. /top [limit]
    // =========================================================================
    this.register({
      command: 'top',
      description: 'Top discovered pump.fun tokens: /top [limit]',
      handler: async ({ replyHtml, args }: TelegramCommandContext) => {
        const parseRes = TopCommandSchema.safeParse({ limit: args[0] });
        if (args[0] !== undefined && !parseRes.success) {
          await replyHtml(
            '❌ <b>Invalid Command Argument:</b>\nLimit must be an integer between 1 and 25 (e.g., <code>/top 10</code>).',
          );
          return;
        }
        const limit = parseRes.success ? parseRes.data.limit : 5;

        const tokens = discoveryService.getCachedTokens();
        if (tokens.length === 0) {
          await replyHtml('ℹ️ No tokens discovered yet in active ingestion stream.');
          return;
        }

        // Sort by initial liquidity or discovery recency
        const sorted = [...tokens].sort(
          (a, b) => b.initialLiquiditySol - a.initialLiquiditySol || b.slot - a.slot,
        );
        const topTokens = sorted.slice(0, limit);

        const rows = topTokens.map((t, idx) => {
          const synth = t.isSynthetic ? ' [SYNTHETIC]' : '';
          return [
            `<b>${idx + 1}. ${escapeHtml(t.symbol)}</b> — <i>${escapeHtml(t.name)}</i>${synth}`,
            `   • Mint: <code>${t.mint}</code>`,
            `   • Liquidity: <b>${t.initialLiquiditySol.toFixed(2)} SOL</b>`,
            `   • Creator: <code>${shortenAddress(t.creator)}</code>`,
            `   • Slot: ${t.slot} (Latency: ${t.discoveryLatencyMs}ms)`,
            `   • State: <code>${escapeHtml(t.lifecycleState)}</code>`,
          ].join('\n');
        });

        const text = [
          `🔥 <b>Top ${topTokens.length} Discovered Tokens</b> (by Liquidity):`,
          '',
          rows.join('\n\n'),
          '',
          '<i>Use /inspect &lt;address&gt; for deep safety and risk analysis.</i>',
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 11. /inspect <token_address>
    // =========================================================================
    this.register({
      command: 'inspect',
      description: 'Deep token risk inspection: /inspect <token_address>',
      handler: async ({ replyHtml, args }: TelegramCommandContext) => {
        const parseRes = InspectCommandSchema.safeParse({ tokenAddress: args[0] });
        if (!parseRes.success) {
          const errs = parseRes.error.issues.map((i) => i.message).join('; ');
          await replyHtml(
            `❌ <b>Invalid Command Argument:</b>\n${escapeHtml(errs)}\n\n<b>Usage:</b> <code>/inspect &lt;token_address&gt;</code>\n<b>Example:</b> <code>/inspect 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P</code>`,
          );
          return;
        }

        const mint = parseRes.data.tokenAddress;
        const cached = discoveryService.getToken(mint);

        try {
          const analysisReport = await tokenAnalysisService.analyzeToken(mint, {
            creatorAddress: cached?.creator,
            bondingCurveAddress: cached?.bondingCurve,
            initialLiquiditySol: cached?.initialLiquiditySol ?? 25.0,
            isSynthetic: cached?.isSynthetic,
          });

          const gateDecision = riskService.evaluateGate({
            mint,
            symbol: cached?.symbol ?? 'TOKEN',
            analysisReport,
            customLiquiditySol: cached?.initialLiquiditySol ?? 25.0,
          });

          const existingPosition = portfolioService.getPosition(mint);

          const gateIcon =
            gateDecision.outcome === 'ELIGIBLE_FOR_STRATEGY'
              ? '🟢'
              : gateDecision.outcome === 'NEEDS_RECHECK'
                ? '🟡'
                : '🔴';

          const mintAuthRevoked = analysisReport.authorities.isMintAuthorityRevoked.value === true;
          const freezeAuthRevoked =
            analysisReport.authorities.isFreezeAuthorityRevoked.value === true;

          const text = [
            `🔍 <b>Deep Token Inspection</b>`,
            `• Token: <b>${escapeHtml(cached?.symbol ?? 'UNKNOWN')}</b> (${escapeHtml(cached?.name ?? 'Unknown Token')})`,
            `• Mint Address: <code>${mint}</code>`,
            '',
            `<b>🛡️ Risk Gate Decision:</b> ${gateIcon} <b>${escapeHtml(gateDecision.outcome)}</b>`,
            `• Decision ID: <code>${gateDecision.decisionId.slice(0, 8)}...</code>`,
            `• Passed: <b>${gateDecision.passed ? 'YES' : 'NO'}</b>`,
            gateDecision.reasons.length > 0
              ? `• Gate Flags:\n  ${gateDecision.reasons.map((r) => `— ${escapeHtml(r)}`).join('\n  ')}`
              : '• Gate Flags: None (Clean Profile)',
            '',
            '<b>🔒 Safety &amp; Contract Authorities:</b>',
            `• Mint Authority Revoked: ${mintAuthRevoked ? '✅ YES' : '❌ NO'}`,
            `• Freeze Authority Revoked: ${freezeAuthRevoked ? '✅ YES' : '❌ NO'}`,
            `• Top 10 Non-Curve Concentration: <b>${analysisReport.largestHolders.nonCurveTop10Percentage.value}%</b>`,
            `• Bonding Curve Supply: <b>${analysisReport.largestHolders.bondingCurvePercentage.value}%</b>`,
            '',
            '<b>👨‍💻 Creator Reputation Profile:</b>',
            `• Creator Address: <code>${cached?.creator ?? 'Unknown'}</code>`,
            `• Wallet Age: ${analysisReport.creatorHistory.walletAgeDays.value} days`,
            `• Reputation Tier: <b>${escapeHtml(String(analysisReport.creatorHistory.reputationTier.value))}</b>`,
            `• Creator Holdings: <b>${analysisReport.creatorHoldings.percentageOfSupply.value}%</b>`,
            '',
            '<b>💧 Liquidity &amp; Market Depth:</b>',
            `• Initial Liquidity: <b>${cached?.initialLiquiditySol ?? analysisReport.liquidityAndDepth.liquiditySol.value} SOL</b>`,
            `• Est. Price: <code>${formatSol(Number(analysisReport.liquidityAndDepth.currentPriceSol.value))} SOL</code>`,
            `• Curve Progress: <b>${analysisReport.liquidityAndDepth.bondingCurveProgressPct.value}%</b>`,
            `• Completeness: <b>${analysisReport.overallSummary.dataCompletenessPct}%</b>`,
            '',
            existingPosition
              ? `💼 <b>Active Position:</b> YES (${existingPosition.amountTokens.toFixed(0)} tokens, PnL: ${formatPct(existingPosition.unrealizedPnlPercent)})`
              : '💼 <b>Active Position:</b> NO',
          ].join('\n');

          await replyHtml(text);
        } catch (err) {
          logger.error({ mint, err }, '[CommandRegistry] Token inspection failed');
          await replyHtml(
            `❌ <b>Inspection Failed:</b> ${escapeHtml((err as Error).message ?? 'Unknown error')}`,
          );
        }
      },
    });

    // =========================================================================
    // 12. /history [page]
    // =========================================================================
    this.register({
      command: 'history',
      description: 'Historical paper trade ledger fills: /history [page]',
      handler: async ({ replyHtml, args }: TelegramCommandContext) => {
        const parseRes = HistoryCommandSchema.safeParse({ page: args[0] });
        if (args[0] !== undefined && !parseRes.success) {
          await replyHtml(
            '❌ <b>Invalid Command Argument:</b>\nPage number must be a positive integer (e.g., <code>/history 2</code>).',
          );
          return;
        }
        const page = parseRes.success ? parseRes.data.page : 1;

        const allTrades = await paperTradingRepository.getAllTrades();
        if (allTrades.length === 0) {
          await replyHtml('ℹ️ <b>No trade fills recorded yet</b> in persistent paper ledger.');
          return;
        }

        const pageSize = 5;
        // Sort descending by executedAt
        const sorted = [...allTrades].sort(
          (a, b) => b.executedAt.getTime() - a.executedAt.getTime(),
        );
        const pagination = paginateArray(sorted, page, pageSize);

        const tradeRows = pagination.items.map((trade, idx) => {
          const globalIdx = (pagination.page - 1) * pageSize + idx + 1;
          const sideIcon = trade.side === 'BUY' ? '🔵' : '🟢';

          return [
            `${globalIdx}. ${sideIcon} <b>${trade.side}</b> — <code>${shortenAddress(trade.tokenMint)}</code>`,
            `   • Executed: ${trade.executedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
            `   • Tokens: <b>${trade.amountTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>`,
            `   • Fill Price: <code>${formatSol(trade.priceSol)} SOL</code>`,
            `   • Gross Value: <b>${formatSol(trade.totalSol)} SOL</b>`,
            `   • Fee: <code>${formatSol(trade.simulatedFeeSol)} SOL</code> (Slip: ${trade.slippageBps} bps)`,
            `   • Reason: <i>${escapeHtml(trade.reason)}</i>`,
          ].join('\n');
        });

        const text = [
          `📜 <b>Paper Trade Ledger History (${allTrades.length} Trades)</b> — Page ${pagination.page}/${pagination.totalPages}:`,
          '',
          tradeRows.join('\n\n'),
          '',
          pagination.totalPages > 1
            ? `<i>Navigate with: /history &lt;page&gt; (e.g. /history ${pagination.page + 1})</i>`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 13. /settings (Sensitive) - Requirement 7
    // =========================================================================
    this.register({
      command: 'settings',
      description: 'View current risk parameters and sanitized environment settings',
      isSensitive: true,
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const riskConfig = portfolioRiskController.getConfig();
        const stratConfig = strategyService.getConfig();
        const allConfig = configService.getAll();
        const state = systemStateService.getState();

        const sanitizedSolanaHttp = sanitizeSecrets(allConfig.SOLANA_RPC_HTTP_URL);
        const sanitizedSolanaWs = sanitizeSecrets(allConfig.SOLANA_RPC_WS_URL);
        const sanitizedHeliusHttp = allConfig.HELIUS_RPC_HTTP_URL
          ? sanitizeSecrets(allConfig.HELIUS_RPC_HTTP_URL)
          : 'None';

        const text = [
          '⚙️ <b>PumpSentinel Configuration &amp; Risk Settings</b>',
          '',
          `• <b>Operating State:</b> <code>${state}</code>`,
          '',
          '<b>🛡️ Portfolio-Risk Controller Limits:</b>',
          `• Stop-Loss Threshold (<code>stop_loss</code>): <b>-${riskConfig.stopLossPct}%</b> (Allowed: 1% to 50%)`,
          `• Take-Profit Target (<code>take_profit</code>): <b>+${riskConfig.takeProfitPct}%</b> (Allowed: 5% to 500%)`,
          `• <code>max_holding_time_sec</code>: <b>${Math.round(riskConfig.maxHoldingDurationMs / 1000)}s</b> (${Math.round(riskConfig.maxHoldingDurationMs / 60000)}m) (Allowed: 10s to 86400s)`,
          `• <code>max_daily_loss</code>: <b>${riskConfig.maxDailyLossPct}%</b> of daily equity (Allowed: 1% to 50%)`,
          `• <code>max_drawdown</code>: <b>${riskConfig.maxDrawdownPct}%</b> from high-water mark (Allowed: 1% to 50%)`,
          `• <code>max_position_size</code>: <b>${riskConfig.maxPositionSizeSol} SOL</b> ($${formatUsd(riskConfig.maxPositionSizeSol * riskConfig.solPriceUsd)}) (Allowed: 0.01 to 100 SOL)`,
          `• <code>max_concurrent_positions</code>: <b>${riskConfig.maxConcurrentPositions}</b> (Allowed: 1 to 50)`,
          `• <code>max_total_exposure_pct</code>: <b>${riskConfig.maxTotalExposurePct}%</b> (${riskConfig.maxTotalExposureSol} SOL) (Allowed: 5% to 100%)`,
          '',
          '<b>🤖 Strategy Parameters:</b>',
          `• <code>auto_trade</code>: <b>${stratConfig.autoTradeEnabled ? 'ON' : 'OFF'}</b> (Allowed: on/off)`,
          `• <code>fixed_buy_amount</code>: <b>${stratConfig.fixedBuyAmountSol} SOL</b> (Allowed: 0.01 to 10 SOL)`,
          '',
          '<b>🔧 Propose Configuration Change:</b>',
          'Use <code>/set &lt;param&gt; &lt;value&gt;</code> to propose a change.\n<i>Example: <code>/set stop_loss 12</code></i>\n<i>Changes require explicit two-phase confirmation (/confirm &lt;token&gt;).</i>',
          '',
          '<b>🌐 RPC Endpoints (Sanitized - Zero Secrets Exposed):</b>',
          `• Solana HTTP: <code>${escapeHtml(sanitizedSolanaHttp)}</code>`,
          `• Solana WS: <code>${escapeHtml(sanitizedSolanaWs)}</code>`,
          `• Helius RPC: <code>${escapeHtml(sanitizedHeliusHttp)}</code>`,
          `• Rate Limit: ${allConfig.RPC_MAX_REQUESTS_PER_SECOND} req/sec`,
          `• Authorized Operators: ${allConfig.TELEGRAM_AUTHORIZED_USER_IDS.length} user(s)`,
        ].join('\n');

        await replyHtml(text);
      },
    });

    // =========================================================================
    // 13b. /set <param> <value> (Sensitive) - Requirement 8
    // =========================================================================
    this.register({
      command: 'set',
      description: 'Propose a configuration change: /set <param> <value>',
      isSensitive: true,
      handler: async ({ replyHtml, userId, username, args }: TelegramCommandContext) => {
        const parseRes = SetCommandSchema.safeParse({ param: args[0], value: args[1] });
        if (!parseRes.success) {
          const allowed = Object.keys(ConfigValueValidators)
            .map((k) => `• <code>${k}</code>`)
            .join('\n');
          await replyHtml(
            `❌ <b>Invalid Command Syntax:</b>\nUsage: <code>/set &lt;param&gt; &lt;value&gt;</code>\n\n<b>Allowed parameters:</b>\n${allowed}\n\n<b>Example:</b> <code>/set stop_loss 12</code>`,
          );
          return;
        }

        const result = systemStateService.proposeConfigChange(
          userId,
          username,
          parseRes.data.param,
          parseRes.data.value,
        );
        await replyHtml(result.message);
      },
    });

    // =========================================================================
    // 13c. /confirm <token> (Sensitive) - Requirement 8
    // =========================================================================
    this.register({
      command: 'confirm',
      description: 'Confirm a proposed configuration change: /confirm <token>',
      isSensitive: true,
      handler: async ({ replyHtml, userId, username, args }: TelegramCommandContext) => {
        const parseRes = ConfirmCommandSchema.safeParse({ token: args[0] });
        if (!parseRes.success) {
          await replyHtml(
            `❌ <b>Invalid Confirmation Token:</b>\nUsage: <code>/confirm &lt;token&gt;</code>\nExample: <code>/confirm cfg_a1b2c3d4</code>`,
          );
          return;
        }

        const result = await systemStateService.confirmConfigChange(
          userId,
          username,
          parseRes.data.token,
        );
        await replyHtml(result.message);
      },
    });

    // =========================================================================
    // 13d. /cancel (Sensitive) - Requirement 8
    // =========================================================================
    this.register({
      command: 'cancel',
      description: 'Cancel any pending configuration changes: /cancel',
      isSensitive: true,
      handler: async ({ replyHtml, userId }: TelegramCommandContext) => {
        const result = systemStateService.cancelConfigChange(userId);
        await replyHtml(result.message);
      },
    });

    // =========================================================================
    // 14. /health
    // =========================================================================
    this.register({
      command: 'health',
      description: 'Check system health, memory usage, and subsystem statuses',
      handler: async ({ replyHtml }: TelegramCommandContext) => {
        const health = await healthService.evaluateHealth();
        const mem = health.memory;
        const icon = health.status === 'ok' ? '✅' : health.status === 'degraded' ? '⚠️' : '❌';

        const days = Math.floor(health.uptimeSeconds / 86400);
        const hours = Math.floor((health.uptimeSeconds % 86400) / 3600);
        const mins = Math.floor((health.uptimeSeconds % 3600) / 60);
        const secs = Math.floor(health.uptimeSeconds % 60);
        const uptimeStr = `${days > 0 ? `${days}d ` : ''}${hours}h ${mins}m ${secs}s`;

        const checkRows = Object.entries(health.checks).map(([name, check]) => {
          const chkIcon = check.status === 'ok' ? '✅' : '⚠️';
          const errStr = check.error ? ` (${escapeHtml(check.error)})` : '';
          return `• ${chkIcon} <b>${escapeHtml(name)}:</b> <code>${escapeHtml(check.status)}</code>${errStr}`;
        });

        const text = [
          `${icon} <b>System Health Report: ${health.status.toUpperCase()}</b>`,
          '',
          `⏱ <b>Uptime:</b> ${uptimeStr}`,
          `🧠 <b>RAM Usage:</b> RSS: <b>${mem.rssMb} MB</b> | Heap: <b>${mem.heapUsedMb} MB / ${mem.heapTotalMb} MB</b>`,
          `💻 <b>OS Memory Used:</b> ${mem.osUsedPercent}% (Free: ${mem.osFreeMb} MB)`,
          `⚡ <b>Memory Constrained:</b> ${mem.isMemoryConstrained ? '⚠️ YES' : '✅ NO'}`,
          '',
          '<b>Subsystem Probes:</b>',
          ...checkRows,
        ].join('\n');

        await replyHtml(text);
      },
    });
  }
}

export const commandRegistry = new CommandRegistry();
