import type { CommandDefinition } from './telegram.types.js';
import { healthService } from '../observability/health.service.js';
import { portfolioService } from '../portfolio/portfolio.service.js';
import { discoveryService } from '../discovery/discovery.service.js';
import { ingestionStreamService } from '../ingestion/stream.service.js';
import { strategyService } from '../strategy/strategy.service.js';
import { paperExecutionEngine } from '../execution/paper-engine.service.js';
import { riskService } from '../risk/risk.service.js';
import { tokenAnalysisService } from '../analysis/index.js';
import { walletHistoryService } from '../wallet-history/index.js';

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
    this.register({
      command: 'start',
      description: 'Welcome to PumpSentinel and safety overview',
      handler: async ({ ctx }) => {
        const text = [
          '🛡️ *PumpSentinel Bot Online*',
          '',
          'Automated Solana pump.fun token monitor & paper-trading sentinel.',
          '',
          '🔒 *Safety Guarantees:*',
          '• 100% Simulated Paper-Trading.',
          '• No real funds or wallet private keys are ever used.',
          '• Optimized for resource-constrained 8 GB RAM Linux hosts.',
          '',
          'Type /help to see all available commands.',
        ].join('\n');
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    });

    this.register({
      command: 'help',
      description: 'List available commands',
      handler: async ({ ctx }) => {
        const text = [
          '📋 *Available Commands:*',
          '',
          '/health - System health, RAM usage, and service statuses',
          '/status - Token discovery and stream ingestion metrics',
          '/portfolio - Simulated SOL balance, total PnL & win rate',
          '/positions - List of active paper-trading positions',
          '/buy <mint> <sol> - Execute a simulated paper BUY order',
          '/sell <mint> - Execute a simulated paper SELL order',
          '/analyze <mint> - In-depth token analysis, supply & authorities',
          '/risk <mint> - View risk engine evaluation for a token',
          '/creator <wallet> - On-chain creator wallet history & reputation',
          '/reset_portfolio - Reset paper balance to initial 10 SOL',
          '/help - Show this guide',
        ].join('\n');
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    });

    this.register({
      command: 'health',
      description: 'Check system health and memory usage',
      handler: async ({ ctx }) => {
        const health = await healthService.evaluateHealth();
        const mem = health.memory;
        const icon = health.status === 'ok' ? '✅' : health.status === 'degraded' ? '⚠️' : '❌';

        const text = [
          `${icon} *System Health: ${health.status.toUpperCase()}*`,
          `⏱ *Uptime:* ${health.uptimeSeconds}s`,
          `🧠 *RSS Memory:* ${mem.rssMb} MB / Heap: ${mem.heapUsedMb} MB`,
          `💻 *OS Memory Used:* ${mem.osUsedPercent}% (Free: ${mem.osFreeMb} MB)`,
          '',
          `*Subsystems:*`,
          ...Object.entries(health.checks).map(([name, check]) => {
            const chkIcon = check.status === 'ok' ? '✅' : '⚠️';
            return `• ${chkIcon} *${name}:* ${check.status}${check.error ? ` (${check.error})` : ''}`;
          }),
        ].join('\n');
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    });

    this.register({
      command: 'status',
      description: 'Ingestion and token discovery status',
      handler: async ({ ctx }) => {
        const streamMetrics = ingestionStreamService.getMetrics();
        const discStats = discoveryService.getStats();
        const stratConfig = strategyService.getConfig();

        const text = [
          '📊 *PumpSentinel Stream Status*',
          '',
          `• Ingestion Status: *${streamMetrics.status}*`,
          `• Events Processed: *${streamMetrics.eventsIngested}*`,
          `• Tokens Discovered: *${discStats.totalDiscovered}*`,
          `• Active Cache Size: *${discStats.activeCacheSize}*`,
          `• Auto-Trade Enabled: *${stratConfig.autoTradeEnabled ? 'YES' : 'NO'}*`,
          `• Default Buy Size: *${stratConfig.fixedBuyAmountSol} SOL*`,
          `• Take Profit Target: *+${stratConfig.takeProfitPct}%*`,
          `• Stop Loss Threshold: *-${stratConfig.stopLossPct}%*`,
        ].join('\n');
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    });

    this.register({
      command: 'portfolio',
      description: 'View simulated portfolio balance and PnL',
      handler: async ({ ctx }) => {
        const p = portfolioService.getSummary();
        const pnlIcon = p.totalPnlSol >= 0 ? '🟢' : '🔴';

        const text = [
          '💼 *Simulated Paper Portfolio*',
          '',
          `💰 *Available Balance:* ${p.currentSolBalance} SOL`,
          `📈 *Invested:* ${p.totalInvestedSol} SOL`,
          `🏦 *Total Value:* ${p.totalPortfolioValueSol} SOL`,
          '',
          `${pnlIcon} *Total PnL:* ${p.totalPnlSol > 0 ? '+' : ''}${p.totalPnlSol} SOL (${p.totalPnlPercent}%)`,
          `• Realized PnL: ${p.realizedPnlSol} SOL`,
          `• Unrealized PnL: ${p.unrealizedPnlSol} SOL`,
          '',
          `🎯 *Performance:*`,
          `• Open Positions: ${p.openPositionsCount}`,
          `• Total Trades: ${p.totalTrades}`,
          `• Win / Loss: ${p.winCount}W / ${p.lossCount}L (Win Rate: ${p.winRatePercent}%)`,
        ].join('\n');
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    });

    this.register({
      command: 'positions',
      description: 'List open paper positions',
      handler: async ({ ctx }) => {
        const positions = portfolioService.getOpenPositions();
        if (positions.length === 0) {
          await ctx.reply('ℹ️ No active open positions in simulated portfolio.');
          return;
        }

        const lines = positions.map((pos, idx) => {
          const pnlIcon = pos.unrealizedPnlSol >= 0 ? '🟢' : '🔴';
          return [
            `${idx + 1}. *${pos.tokenSymbol}* (\`${pos.tokenMint.slice(0, 6)}...${pos.tokenMint.slice(-4)}\`)`,
            `   • Tokens: ${pos.amountTokens.toFixed(2)}`,
            `   • Entry: ${pos.entryPriceSol.toFixed(6)} SOL`,
            `   • Current: ${pos.currentPriceSol.toFixed(6)} SOL`,
            `   • Invested: ${pos.solInvested.toFixed(4)} SOL`,
            `   • PnL: ${pnlIcon} ${pos.unrealizedPnlSol >= 0 ? '+' : ''}${pos.unrealizedPnlSol.toFixed(4)} SOL (${pos.unrealizedPnlPercent.toFixed(2)}%)`,
          ].join('\n');
        });

        await ctx.reply(
          `📋 *Active Open Positions (${positions.length}):*\n\n${lines.join('\n\n')}`,
          {
            parse_mode: 'Markdown',
          },
        );
      },
    });

    this.register({
      command: 'buy',
      description: 'Simulate paper buy: /buy <mint> <solAmount>',
      handler: async ({ ctx, args }) => {
        const [mint, solAmountStr] = args;
        if (!mint || !solAmountStr) {
          await ctx.reply('Usage: `/buy <tokenMint> <solAmount>`\nExample: `/buy 6EF8... 0.5`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const solAmount = Number(solAmountStr);
        if (Number.isNaN(solAmount) || solAmount <= 0) {
          await ctx.reply('❌ Invalid SOL amount provided.');
          return;
        }

        try {
          const cachedToken = discoveryService.getToken(mint);
          const symbol = cachedToken?.symbol ?? 'TOKEN';
          const mockPrice = 0.00005; // Fallback mock price

          const trade = paperExecutionEngine.executeSimulatedOrder({
            tokenMint: mint,
            tokenSymbol: symbol,
            side: 'BUY',
            solAmount,
            currentPriceSol: mockPrice,
            reason: 'Manual Telegram command /buy',
          });

          portfolioService.recordTrade(trade);

          await ctx.reply(
            [
              '✅ *Simulated Paper BUY Executed*',
              `• Token: *${trade.tokenSymbol}* (\`${trade.tokenMint.slice(0, 8)}...\`)`,
              `• Spent: *${trade.totalSol} SOL*`,
              `• Received: *${trade.amountTokens.toFixed(2)} tokens*`,
              `• Fill Price: *${trade.executedPriceSol.toFixed(8)} SOL*`,
              `• Sim Fee: *${trade.simulatedFeeSol} SOL*`,
            ].join('\n'),
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await ctx.reply(`❌ Order failed: ${message}`);
        }
      },
    });

    this.register({
      command: 'sell',
      description: 'Simulate paper sell: /sell <mint>',
      handler: async ({ ctx, args }) => {
        const [mint] = args;
        if (!mint) {
          await ctx.reply('Usage: `/sell <tokenMint>`', { parse_mode: 'Markdown' });
          return;
        }

        const position = portfolioService.getPosition(mint);
        if (!position) {
          await ctx.reply(`❌ No open position found for token mint: \`${mint}\``, {
            parse_mode: 'Markdown',
          });
          return;
        }

        try {
          const trade = paperExecutionEngine.executeSimulatedOrder({
            tokenMint: mint,
            tokenSymbol: position.tokenSymbol,
            side: 'SELL',
            tokenAmount: position.amountTokens,
            currentPriceSol: position.currentPriceSol,
            reason: 'Manual Telegram command /sell',
          });

          portfolioService.recordTrade(trade);

          await ctx.reply(
            [
              '✅ *Simulated Paper SELL Executed*',
              `• Token: *${trade.tokenSymbol}*`,
              `• Sold: *${trade.amountTokens.toFixed(2)} tokens*`,
              `• Return: *${trade.totalSol.toFixed(4)} SOL*`,
              `• Fill Price: *${trade.executedPriceSol.toFixed(8)} SOL*`,
            ].join('\n'),
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await ctx.reply(`❌ Sell failed: ${message}`);
        }
      },
    });

    this.register({
      command: 'risk',
      description: 'Check risk score: /risk <mint>',
      handler: async ({ ctx, args }) => {
        const [mint] = args;
        if (!mint) {
          await ctx.reply('Usage: `/risk <tokenMint>`', { parse_mode: 'Markdown' });
          return;
        }

        const cached = discoveryService.getToken(mint);
        const assessment = riskService.assess({
          mint,
          symbol: cached?.symbol ?? 'UNKNOWN',
          liquiditySol: cached?.initialLiquiditySol ?? 20.0,
          top10HoldingPct: 25.0,
          devHoldingPct: 5.0,
          hasValidMetadata: true,
          hasSocials: true,
          suspectedSniperCount: 1,
        });

        const icon = assessment.passed ? '🟢' : '🔴';
        const text = [
          `${icon} *Risk Assessment for ${cached?.symbol ?? 'Token'}*`,
          `• Score: *${assessment.score} / 100* (${assessment.passed ? 'PASSED' : 'FLAGGED'})`,
          `• Status: ${assessment.passed ? 'Safe to Paper Trade' : 'High Risk'}`,
          assessment.reasons.length > 0
            ? `• Flags:\n  - ${assessment.reasons.join('\n  - ')}`
            : '• Flags: None detected',
        ].join('\n');

        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    });

    this.register({
      command: 'analyze',
      description: 'Analyze token data: /analyze <mint>',
      handler: async ({ ctx, args }) => {
        const [mint] = args;
        if (!mint) {
          await ctx.reply('Usage: `/analyze <tokenMint>`\nExample: `/analyze 6EF8...`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const cached = discoveryService.getToken(mint);
        try {
          const report = await tokenAnalysisService.analyzeToken(mint, {
            creatorAddress: cached?.creator,
            bondingCurveAddress: cached?.bondingCurve,
            initialLiquiditySol: cached?.initialLiquiditySol,
            isSynthetic: cached?.isSynthetic,
          });

          const fmt = (v: unknown) => (v === 'UNKNOWN' ? '_UNKNOWN_' : String(v));

          const text = [
            `🔍 *Token Analysis:* \`${mint.slice(0, 6)}...${mint.slice(-4)}\``,
            '',
            `📊 *Supply & Authorities:*`,
            `• Supply: ${fmt(report.supply.supply.value)} (Decimals: ${fmt(report.supply.decimals.value)})`,
            `• Mint Auth Revoked: ${fmt(report.authorities.isMintAuthorityRevoked.value)}`,
            `• Freeze Auth Revoked: ${fmt(report.authorities.isFreezeAuthorityRevoked.value)}`,
            '',
            `👥 *Holders & Distribution:*`,
            `• Top 10 Non-Curve: ${fmt(report.largestHolders.nonCurveTop10Percentage.value)}%`,
            `• Bonding Curve: ${fmt(report.largestHolders.bondingCurvePercentage.value)}%`,
            `• Concentration Risk: ${report.largestHolders.hasHighConcentration.value ? '⚠️ HIGH' : '✅ LOW'}`,
            '',
            `👨‍💻 *Creator Profile:*`,
            `• Wallet Age: ${fmt(report.creatorHistory.walletAgeDays.value)} days`,
            `• Reputation Tier: *${fmt(report.creatorHistory.reputationTier.value)}*`,
            `• Creator Holdings: ${fmt(report.creatorHoldings.percentageOfSupply.value)}%`,
            '',
            `💧 *Liquidity & Depth:*`,
            `• Liquidity: ${fmt(report.liquidityAndDepth.liquiditySol.value)} SOL`,
            `• Est. Price: ${fmt(report.liquidityAndDepth.currentPriceSol.value)} SOL`,
            `• Curve Progress: ${fmt(report.liquidityAndDepth.bondingCurveProgressPct.value)}%`,
            '',
            `🔗 *Connected Wallets:* ${fmt(report.relatedWallets.connectedWalletCount.value)} (Evidence-based)`,
            `• Data Completeness: *${report.overallSummary.dataCompletenessPct}%*`,
          ].join('\n');

          await ctx.reply(text, { parse_mode: 'Markdown' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await ctx.reply(`❌ Analysis failed: ${message}`);
        }
      },
    });

    this.register({
      command: 'reset_portfolio',
      description: 'Reset simulated portfolio to 10 SOL',
      handler: async ({ ctx }) => {
        portfolioService.reset(10.0);
        await ctx.reply('🔄 Simulated portfolio has been reset to *10.0 SOL*.', {
          parse_mode: 'Markdown',
        });
      },
    });

    this.register({
      command: 'creator',
      description: 'Historical wallet analysis: /creator <address>',
      handler: async ({ ctx, args }) => {
        const [wallet] = args;
        if (!wallet) {
          await ctx.reply('Usage: `/creator <walletAddress>`\nExample: `/creator 6EF8...`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        try {
          const profile = await walletHistoryService.analyzeWalletHistory(wallet);
          const icon =
            profile.riskLevel === 'SAFE'
              ? '🟢'
              : profile.riskLevel === 'LOW'
                ? '🟡'
                : profile.riskLevel === 'MEDIUM'
                  ? '🟠'
                  : profile.riskLevel === 'UNKNOWN'
                    ? '⚪'
                    : '🔴';

          const text = [
            `${icon} *Historical Wallet Analysis*`,
            `• Address: \`${wallet.slice(0, 6)}...${wallet.slice(-4)}\``,
            `• Risk Level: *${profile.riskLevel}* (Score: ${profile.riskScore}/100)`,
            `• Coverage: *${profile.coverage.coverage}* (${profile.coverage.totalSignaturesObserved} txs)`,
            `• Freshness: ${profile.isFresh ? 'FRESH (cached)' : 'LIVE'}`,
            '',
            `📊 *Observed Activity:*`,
            `• Prior Launches: *${profile.launches.length}*`,
            `• Large Transfers: *${profile.largeTransfers.length}*`,
            `• Early Purchases / Snipes: *${profile.earlyPurchases.length}*`,
            `• Repeated Relationships: *${profile.repeatedRelationships.length}*`,
            '',
            profile.warnings.length > 0
              ? `⚠️ *Warnings (${profile.warnings.length}):*\n` +
                profile.warnings.map((w) => `• [${w.code}] ${w.title}`).join('\n')
              : '✅ *Warnings:* No suspicious historical patterns detected.',
            '',
            `ℹ️ _${profile.explanation}_`,
          ].join('\n');

          await ctx.reply(text, { parse_mode: 'Markdown' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await ctx.reply(`❌ Wallet analysis failed: ${message}`);
        }
      },
    });
  }
}

export const commandRegistry = new CommandRegistry();
