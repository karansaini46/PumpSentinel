import { Bot } from 'grammy';
import type {
  INotificationChannel,
  SentinelNotification,
} from '../notifications/notifications.types.js';
import { commandRegistry } from './command-registry.js';
import { configService } from '../configuration/config.service.js';
import { logger } from '../observability/logger.js';

export class TelegramBotService implements INotificationChannel {
  private bot: Bot | null = null;
  private isRunning = false;

  public initialize(tokenOverride?: string): Bot {
    const token = tokenOverride ?? configService.get('TELEGRAM_BOT_TOKEN');

    this.bot = new Bot(token);

    // Error boundary middleware
    this.bot.catch((err) => {
      logger.error({ err }, '[TelegramBot] Uncaught error in bot handler');
    });

    // Authorization middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      if (!configService.isAuthorizedUser(userId)) {
        logger.warn({ userId }, '[TelegramBot] Unauthorized user attempted command');
        await ctx.reply('⛔ Unauthorized: You do not have permission to access PumpSentinel.');
        return;
      }

      await next();
    });

    // Wire command registry
    for (const cmd of commandRegistry.getCommands()) {
      this.bot.command(cmd.command, async (ctx) => {
        const userId = ctx.from?.id ?? 0;
        const text = ctx.message?.text ?? '';
        const args = text.split(/\s+/).slice(1);
        await cmd.handler({ ctx, userId, args });
      });
    }

    // Fallback for non-command text
    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) {
        await ctx.reply('❓ Unknown command. Send /help to see available commands.');
      } else {
        await ctx.reply(
          '👋 PumpSentinel is listening. Send /help to view available commands, or /health to check system status.',
        );
      }
    });

    return this.bot;
  }

  public async start(): Promise<void> {
    if (!this.bot) {
      this.initialize();
    }

    if (this.isRunning) return;

    // Register commands in Telegram client menu
    try {
      await this.bot?.api.setMyCommands(
        commandRegistry.getCommands().map((c) => ({
          command: c.command,
          description: c.description,
        })),
      );
      logger.info('[TelegramBot] Registered bot commands with Telegram UI menu');
    } catch (err) {
      logger.warn({ err }, '[TelegramBot] Failed to set bot commands in Telegram UI menu');
    }

    // In local development or dry-run, start polling
    this.isRunning = true;
    logger.info('[TelegramBot] Starting Telegram bot polling...');
    this.bot
      ?.start({
        onStart: (botInfo) => {
          logger.info({ username: botInfo.username }, '[TelegramBot] Telegram bot connected');
        },
      })
      .catch((err) => {
        this.isRunning = false;
        logger.error({ err }, '[TelegramBot] Bot polling stopped with error');
      });
  }

  public async stop(): Promise<void> {
    if (this.bot && this.isRunning) {
      await this.bot.stop();
      this.isRunning = false;
      logger.info('[TelegramBot] Bot stopped');
    }
  }

  public get running(): boolean {
    return this.isRunning;
  }

  /**
   * Push notification to all authorized users
   */
  public async send(notification: SentinelNotification): Promise<void> {
    if (!this.bot || !this.isRunning) return;

    const authorizedUsers = configService.get('TELEGRAM_AUTHORIZED_USER_IDS');
    if (authorizedUsers.length === 0) return;

    const text = [
      `🔔 *[${notification.priority}] ${notification.title}*`,
      '',
      notification.message,
    ].join('\n');

    for (const userId of authorizedUsers) {
      try {
        await this.bot.api.sendMessage(userId, text, { parse_mode: 'Markdown' });
      } catch (err) {
        logger.warn({ err, userId }, '[TelegramBot] Could not deliver notification');
      }
    }
  }
}

export const telegramBotService = new TelegramBotService();
