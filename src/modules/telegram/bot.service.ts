import crypto from 'node:crypto';
import { Bot } from 'grammy';
import type {
  INotificationChannel,
  SentinelNotification,
} from '../notifications/notifications.types.js';
import type { CommandAuditRecord } from './telegram.types.js';
import { commandRegistry } from './command-registry.js';
import { telegramDeduplicator } from './telegram-deduplicator.js';
import { telegramRateLimiter } from './telegram-rate-limiter.js';
import { sanitizeSecrets, chunkMessage, escapeHtml } from './telegram-utils.js';
import { systemStateRepository } from '../system-state/index.js';
import { configService } from '../configuration/config.service.js';
import { prismaService } from '../persistence/prisma.service.js';
import { logger } from '../observability/logger.js';

export class TelegramBotService implements INotificationChannel {
  private bot: Bot | null = null;
  private isRunning = false;
  private auditHistory: CommandAuditRecord[] = [];
  private readonly maxAuditHistory = 100;
  private webhookSecretToken?: string;

  public initialize(tokenOverride?: string, webhookSecret?: string): Bot {
    const token = tokenOverride ?? configService.get('TELEGRAM_BOT_TOKEN');
    this.webhookSecretToken = webhookSecret ?? process.env['TELEGRAM_WEBHOOK_SECRET'];

    const botId = Number(token.split(':')[0]) || 123456789;
    this.bot = new Bot(token, {
      botInfo: {
        id: botId,
        is_bot: true,
        first_name: 'PumpSentinelBot',
        username: 'pumpsentinel_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      },
    });

    // 1. Error boundary middleware
    this.bot.catch((err) => {
      logger.error({ err }, '[TelegramBot] Uncaught error in bot middleware handler');
    });

    // 2. Idempotency & Deduplication middleware (Requirement 4)
    this.bot.use(async (ctx, next) => {
      const updateId = ctx.update?.update_id;
      const messageId = ctx.message?.message_id;
      const userId = ctx.from?.id;

      const dedupeKey = updateId
        ? `update_${updateId}`
        : userId && messageId
          ? `msg_${userId}_${messageId}`
          : null;

      if (dedupeKey && telegramDeduplicator.checkAndMark(dedupeKey)) {
        logger.warn({ dedupeKey }, '[TelegramBot] Duplicate update/message dropped');
        if (userId) {
          this.recordAudit({
            id: `audit_${crypto.randomUUID()}`,
            userId,
            username: ctx.from?.username,
            command: ctx.message?.text?.split(/\s+/)[0] ?? 'UPDATE',
            args: [],
            status: 'DUPLICATE_IGNORED',
            durationMs: 0,
            error: 'Duplicate update or message dropped by deduplicator',
            timestamp: new Date(),
          });
        }
        return; // Drop duplicate
      }

      await next();
    });

    // 3. Authorization middleware (Requirements 1 & 2)
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      if (!configService.isAuthorizedUser(userId)) {
        logger.warn({ userId }, '[TelegramBot] Unauthorized user rejected before execution');
        this.recordAudit({
          id: `audit_${crypto.randomUUID()}`,
          userId,
          username: ctx.from?.username,
          command: ctx.message?.text?.split(/\s+/)[0] ?? 'UNKNOWN',
          args: [],
          status: 'REJECTED_UNAUTHORIZED',
          durationMs: 0,
          error: 'User is not in the authorized Telegram allowlist',
          timestamp: new Date(),
        });

        await ctx.reply(
          '⛔ <b>Unauthorized</b>: You do not have permission to access PumpSentinel.',
          { parse_mode: 'HTML' },
        );
        return;
      }

      await next();
    });

    // 4. Rate Limiter middleware (Requirement 8)
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const check = telegramRateLimiter.checkLimit(userId);
      if (!check.allowed) {
        logger.warn(
          { userId, retryAfter: check.retryAfterSeconds },
          '[TelegramBot] Command rate limit exceeded',
        );
        this.recordAudit({
          id: `audit_${crypto.randomUUID()}`,
          userId,
          username: ctx.from?.username,
          command: ctx.message?.text?.split(/\s+/)[0] ?? 'UNKNOWN',
          args: [],
          status: 'REJECTED_RATE_LIMIT',
          durationMs: 0,
          error: `Rate limit exceeded. Retry after ${check.retryAfterSeconds}s`,
          timestamp: new Date(),
        });

        await ctx.reply(
          `⏳ <b>Rate Limit Exceeded</b>\nPlease wait ${check.retryAfterSeconds}s before sending another command.`,
          { parse_mode: 'HTML' },
        );
        return;
      }

      await next();
    });

    // 5. Wire all 14 official commands from command registry
    for (const cmd of commandRegistry.getCommands()) {
      this.bot.command(cmd.command, async (ctx) => {
        const startMs = Date.now();
        const userId = ctx.from?.id ?? 0;
        const username = ctx.from?.username;
        const text = ctx.message?.text ?? '';
        const args = text.split(/\s+/).slice(1);

        // Sensitive command check (Requirement 1)
        if (cmd.isSensitive) {
          const authorizedList = configService.get('TELEGRAM_AUTHORIZED_USER_IDS');
          if (authorizedList.length === 0 || !authorizedList.includes(userId)) {
            logger.warn(
              { userId, command: cmd.command },
              '[TelegramBot] Sensitive command rejected: user not in explicit allowlist',
            );
            await ctx.reply(
              '⛔ <b>Forbidden:</b> This sensitive command requires explicit operator authorization.',
              { parse_mode: 'HTML' },
            );
            return;
          }
        }

        // Safe replyHtml helper (Requirements 5, 6, 7, 10)
        const replyHtml = async (html: string) => {
          const sanitized = sanitizeSecrets(html);
          const chunks = chunkMessage(sanitized, 4000);
          for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: 'HTML' });
          }
        };

        try {
          await cmd.handler({ ctx, userId, username, args, replyHtml });

          this.recordAudit({
            id: `audit_${crypto.randomUUID()}`,
            userId,
            username,
            command: cmd.command,
            args,
            status: 'SUCCESS',
            durationMs: Date.now() - startMs,
            timestamp: new Date(),
          });
        } catch (err) {
          const durationMs = Date.now() - startMs;
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(
            { cmd: cmd.command, userId, err, durationMs },
            '[TelegramBot] Command execution failed',
          );

          this.recordAudit({
            id: `audit_${crypto.randomUUID()}`,
            userId,
            username,
            command: cmd.command,
            args,
            status: 'EXECUTION_FAILED',
            durationMs,
            error: errMsg,
            timestamp: new Date(),
          });

          await replyHtml(
            `❌ <b>Error:</b> An error occurred while executing <code>/${cmd.command}</code>: ${errMsg}`,
          );
        }
      });
    }

    // 6. Fallback for non-command text and unknown commands (Requirement 9)
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      const userId = ctx.from?.id ?? 0;
      const username = ctx.from?.username;

      if (text.startsWith('/')) {
        const cmdName = text.split(/\s+/)[0]?.slice(1) ?? '';
        this.recordAudit({
          id: `audit_${crypto.randomUUID()}`,
          userId,
          username,
          command: cmdName,
          args: text.split(/\s+/).slice(1),
          status: 'UNKNOWN_COMMAND',
          durationMs: 0,
          error: `Unknown command: /${cmdName}`,
          timestamp: new Date(),
        });

        await ctx.reply(
          `❓ <b>Unknown command:</b> <code>/${escapeHtml(cmdName)}</code>\nType /help to see all available commands.`,
          { parse_mode: 'HTML' },
        );
      } else {
        await ctx.reply(
          '👋 <b>PumpSentinel is listening.</b> Type /help to view command reference or /status for stream status.',
          { parse_mode: 'HTML' },
        );
      }
    });

    return this.bot;
  }

  /**
   * Starts local development polling.
   */
  public async start(): Promise<void> {
    if (!this.bot) {
      this.initialize();
    }

    if (this.isRunning) return;

    // Register commands in Telegram client UI menu
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

  public getBot(): Bot | null {
    return this.bot;
  }

  /**
   * Secure Webhook Deployment Support.
   * Processes an incoming HTTP update safely with secret-token verification.
   */
  public async handleWebhookUpdate(
    secretTokenHeader: string | undefined,
    update: unknown,
  ): Promise<{ status: number; body: string }> {
    if (!this.bot) {
      this.initialize();
    }

    // Verify webhook secret token if configured
    if (this.webhookSecretToken && secretTokenHeader !== this.webhookSecretToken) {
      logger.warn('[TelegramBot] Webhook update rejected: Invalid secret token');
      return { status: 403, body: 'Forbidden: Invalid secret token' };
    }

    if (!update || typeof update !== 'object') {
      return { status: 400, body: 'Bad Request: Missing update payload' };
    }

    try {
      // @ts-expect-error Grammy update handling
      await this.bot?.handleUpdate(update);
      return { status: 200, body: 'OK' };
    } catch (err) {
      logger.error({ err }, '[TelegramBot] Error handling webhook update');
      return { status: 500, body: 'Internal Server Error' };
    }
  }

  /**
   * Outgoing Alert Notification Delivery: Sanitizes secrets and sends to allowlist.
   */
  public async send(notification: SentinelNotification): Promise<void> {
    if (!this.bot || !this.isRunning) return;

    const authorizedUsers = configService.get('TELEGRAM_AUTHORIZED_USER_IDS');
    if (authorizedUsers.length === 0) return;

    const hasHeader =
      notification.message.includes('<b>') &&
      (notification.message.includes('[PAPER') ||
        notification.message.includes('[CRITICAL') ||
        notification.message.includes('[HIGH') ||
        notification.message.includes('[MEDIUM') ||
        notification.message.includes('[LOW'));

    const rawText = hasHeader
      ? notification.message
      : [
          `🔔 <b>[${notification.priority}] ${notification.title}</b>`,
          '',
          notification.message,
        ].join('\n');

    const sanitizedText = sanitizeSecrets(rawText);
    const chunks = chunkMessage(sanitizedText, 4000);

    for (const userId of authorizedUsers) {
      for (const chunk of chunks) {
        try {
          await this.bot.api.sendMessage(userId, chunk, { parse_mode: 'HTML' });
        } catch (err) {
          logger.warn({ err, userId }, '[TelegramBot] Could not deliver notification to user');
        }
      }
    }
  }

  /**
   * Record command execution and failures (Requirement 12)
   */
  private recordAudit(record: CommandAuditRecord): void {
    this.auditHistory.unshift(record);
    if (this.auditHistory.length > this.maxAuditHistory) {
      this.auditHistory.pop();
    }

    logger.info(
      {
        userId: record.userId,
        command: record.command,
        status: record.status,
        durationMs: record.durationMs,
        error: record.error,
      },
      '[TelegramBot] Command executed and audited',
    );

    // Persist to local disk audit log and PostgreSQL
    void systemStateRepository.recordAudit(record);
    if (prismaService.connected) {
      try {
        const client = prismaService.getClient();
        void client.sentinelEventLog
          .create({
            data: {
              category: 'TELEGRAM_COMMAND',
              level: record.status === 'SUCCESS' ? 'INFO' : 'WARN',
              message: `Command /${record.command} by user ${record.userId}: ${record.status}`,
              metadata: {
                userId: record.userId,
                username: record.username,
                command: record.command,
                args: record.args,
                status: record.status,
                durationMs: record.durationMs,
                error: record.error,
              },
            },
          })
          .catch(() => {});
      } catch {
        // Ignore DB log failures gracefully
      }
    }
  }

  public getRecentAuditLogs(limit = 20): CommandAuditRecord[] {
    return this.auditHistory.slice(0, limit);
  }
}

export const telegramBotService = new TelegramBotService();
