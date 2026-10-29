import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  escapeHtml,
  sanitizeSecrets,
  chunkMessage,
  paginateArray,
  shortenAddress,
  formatSol,
  formatUsd,
  formatPct,
} from '../../src/modules/telegram/telegram-utils.js';
import { TelegramRateLimiter } from '../../src/modules/telegram/telegram-rate-limiter.js';
import { TelegramDeduplicator } from '../../src/modules/telegram/telegram-deduplicator.js';
import {
  InspectCommandSchema,
  PaginationSchema,
  TopCommandSchema,
  HistoryCommandSchema,
} from '../../src/modules/telegram/telegram.types.js';
import { commandRegistry } from '../../src/modules/telegram/command-registry.js';
import { TelegramBotService } from '../../src/modules/telegram/bot.service.js';
import { portfolioRiskController } from '../../src/modules/risk/portfolio-risk-controller.js';
import { discoveryService } from '../../src/modules/discovery/discovery.service.js';
import { configService } from '../../src/modules/configuration/config.service.js';
import type { TelegramCommandContext } from '../../src/modules/telegram/telegram.types.js';

describe('Telegram Control Interface Module', () => {
  // =========================================================================
  // 1. Telegram Utilities
  // =========================================================================
  describe('Telegram Utilities (telegram-utils)', () => {
    it('escapes HTML special characters correctly', () => {
      expect(escapeHtml('Hello <World> & "Friends"')).toBe('Hello &lt;World&gt; &amp; "Friends"');
      expect(escapeHtml('')).toBe('');
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(12345)).toBe('12345');
    });

    it('sanitizes and redacts secrets from text', () => {
      // 1. URL Query Parameter API Keys
      const urlText =
        'Connecting to https://mainnet.helius-rpc.com/?api-key=abc123secretXYZ and done';
      expect(sanitizeSecrets(urlText)).toContain('?api-key=***REDACTED***');
      expect(sanitizeSecrets(urlText)).not.toContain('abc123secretXYZ');

      // 2. Database Connection Strings
      const dbText =
        'DB connected: postgresql://sentinel_user:super_secret_pw@localhost:5432/sentinel';
      expect(sanitizeSecrets(dbText)).toContain(
        'postgresql://sentinel_user:***REDACTED***@localhost',
      );
      expect(sanitizeSecrets(dbText)).not.toContain('super_secret_pw');

      // 3. Telegram Bot Tokens
      const botTokenText =
        'Active bot token is 123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567 on server';
      expect(sanitizeSecrets(botTokenText)).toContain('123456789:***REDACTED***');
      expect(sanitizeSecrets(botTokenText)).not.toContain('ABCdefGHIjklMNOpqrsTUVwxyz1234567');

      // 4. Solana Private Key hints
      const pkText = 'Wallet private-key: 5Kxyz123456789FakeSolanaKeyHere';
      expect(sanitizeSecrets(pkText)).toContain('private-key: ***REDACTED***');
      expect(sanitizeSecrets(pkText)).not.toContain('5Kxyz123456789FakeSolanaKeyHere');

      // 5. Bearer tokens
      const bearerText = 'Authorization: Bearer my_jwt_token_12345';
      expect(sanitizeSecrets(bearerText)).toContain('Bearer ***REDACTED***');
      expect(sanitizeSecrets(bearerText)).not.toContain('my_jwt_token_12345');
    });

    it('chunks long messages within character limits without breaking mid-line', () => {
      const shortMsg = 'Short message that fits easily.';
      expect(chunkMessage(shortMsg, 100)).toEqual([shortMsg]);

      const lines = [
        'Line 1: Introductory status block',
        'Line 2: Token details and metrics',
        'Line 3: Risk assessment information',
        'Line 4: Portfolio balance details',
      ];
      const multiLineText = lines.join('\n');
      const chunks = chunkMessage(multiLineText, 70);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(70);
      }
      // Reconstituted content should contain all lines
      const joined = chunks.join('\n');
      for (const line of lines) {
        expect(joined).toContain(line);
      }
    });

    it('paginates arrays correctly with bounds clamping', () => {
      const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const page1 = paginateArray(items, 1, 3);

      expect(page1.items).toEqual(['a', 'b', 'c']);
      expect(page1.page).toBe(1);
      expect(page1.totalPages).toBe(3);
      expect(page1.totalItems).toBe(7);
      expect(page1.hasNext).toBe(true);
      expect(page1.hasPrev).toBe(false);

      const page2 = paginateArray(items, 2, 3);
      expect(page2.items).toEqual(['d', 'e', 'f']);
      expect(page2.hasNext).toBe(true);
      expect(page2.hasPrev).toBe(true);

      const page3 = paginateArray(items, 3, 3);
      expect(page3.items).toEqual(['g']);
      expect(page3.hasNext).toBe(false);
      expect(page3.hasPrev).toBe(true);

      // Clamp beyond total pages
      const clampedPage = paginateArray(items, 99, 3);
      expect(clampedPage.page).toBe(3);
      expect(clampedPage.items).toEqual(['g']);

      // Empty array
      const empty = paginateArray([], 1, 5);
      expect(empty.items).toEqual([]);
      expect(empty.totalItems).toBe(0);
      expect(empty.totalPages).toBe(1);
    });

    it('formats addresses, numbers, and currencies cleanly', () => {
      const mint = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
      expect(shortenAddress(mint)).toBe('6EF8rr...wF6P');
      expect(shortenAddress('short')).toBe('short');

      expect(formatSol(1.2345678)).toBe('1.2346');
      expect(formatUsd(150.999)).toBe('151.00');
      expect(formatPct(15.5)).toBe('+15.50%');
      expect(formatPct(-8.2)).toBe('-8.20%');
    });
  });

  // =========================================================================
  // 2. Telegram Rate Limiter
  // =========================================================================
  describe('Telegram Rate Limiter (telegram-rate-limiter)', () => {
    it('allows requests within threshold and blocks requests exceeding limit', () => {
      const limiter = new TelegramRateLimiter({ maxRequests: 3, windowMs: 5000 });
      const userId = 1001;
      const now = 100000;

      expect(limiter.checkLimit(userId, now).allowed).toBe(true);
      expect(limiter.checkLimit(userId, now + 100).allowed).toBe(true);
      expect(limiter.checkLimit(userId, now + 200).allowed).toBe(true);

      // 4th request exceeds limit
      const blocked = limiter.checkLimit(userId, now + 300);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

      // Another user is not blocked
      expect(limiter.checkLimit(1002, now + 350).allowed).toBe(true);

      // After window slides forward, requests are allowed again
      expect(limiter.checkLimit(userId, now + 5100).allowed).toBe(true);
    });

    it('cleans up stale user records', () => {
      const limiter = new TelegramRateLimiter({ maxRequests: 2, windowMs: 1000 });
      limiter.checkLimit(2001, 1000);
      limiter.checkLimit(2002, 1000);

      // Advance past windowMs and run cleanup
      limiter.cleanup(3000);

      // Reset works
      limiter.reset();
      expect(limiter.checkLimit(2001, 3000).allowed).toBe(true);
    });
  });

  // =========================================================================
  // 3. Telegram Deduplicator
  // =========================================================================
  describe('Telegram Deduplicator (telegram-deduplicator)', () => {
    it('detects and drops duplicate updates or messages', () => {
      const dedupe = new TelegramDeduplicator(10000, 100);
      const updateKey = 'update_987654321';

      // First check: not duplicate, marked as processed
      expect(dedupe.checkAndMark(updateKey, 5000)).toBe(false);

      // Second check: is duplicate
      expect(dedupe.checkAndMark(updateKey, 6000)).toBe(true);

      // Different key: not duplicate
      expect(dedupe.checkAndMark('update_987654322', 6000)).toBe(false);

      // After TTL expires, key is no longer duplicate
      expect(dedupe.isDuplicate(updateKey, 16000)).toBe(false);

      dedupe.reset();
      expect(dedupe.isDuplicate('update_987654322', 6000)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Command Input Validation Schemas
  // =========================================================================
  describe('Zod Command Input Validation (telegram.types)', () => {
    it('validates /inspect token address strictly as Base58 Solana public key', () => {
      const validMint = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
      expect(InspectCommandSchema.safeParse({ tokenAddress: validMint }).success).toBe(true);

      // Too short
      expect(InspectCommandSchema.safeParse({ tokenAddress: 'abc123' }).success).toBe(false);

      // Invalid characters (0, O, I, l are forbidden in Base58)
      expect(
        InspectCommandSchema.safeParse({
          tokenAddress: '0OIl6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBE',
        }).success,
      ).toBe(false);
    });

    it('validates /top limit within 1 to 25', () => {
      expect(TopCommandSchema.safeParse({ limit: 5 }).success).toBe(true);
      expect(TopCommandSchema.safeParse({ limit: 1 }).success).toBe(true);
      expect(TopCommandSchema.safeParse({ limit: 25 }).success).toBe(true);

      // Default when omitted
      const defaultParsed = TopCommandSchema.safeParse({});
      expect(defaultParsed.success).toBe(true);
      if (defaultParsed.success) {
        expect(defaultParsed.data.limit).toBe(5);
      }

      // Invalid values
      expect(TopCommandSchema.safeParse({ limit: 0 }).success).toBe(false);
      expect(TopCommandSchema.safeParse({ limit: 50 }).success).toBe(false);
      expect(TopCommandSchema.safeParse({ limit: 'invalid' }).success).toBe(false);
    });

    it('validates /positions and /history pagination schemas', () => {
      expect(PaginationSchema.safeParse({ page: '2' }).success).toBe(true);
      expect(PaginationSchema.safeParse({ page: 1 }).success).toBe(true);
      expect(PaginationSchema.safeParse({ page: 0 }).success).toBe(false);
      expect(PaginationSchema.safeParse({ page: -1 }).success).toBe(false);

      const histParsed = HistoryCommandSchema.safeParse({ page: '3', pageSize: '10' });
      expect(histParsed.success).toBe(true);
      if (histParsed.success) {
        expect(histParsed.data.page).toBe(3);
        expect(histParsed.data.pageSize).toBe(10);
      }
    });
  });

  // =========================================================================
  // 5. Command Registry: All 14 Commands
  // =========================================================================
  describe('Command Registry (command-registry)', () => {
    it('registers all 14 official Telegram commands', () => {
      const requiredCommands = [
        'start',
        'help',
        'status',
        'paper',
        'pause',
        'resume',
        'positions',
        'balance',
        'pnl',
        'top',
        'inspect',
        'history',
        'settings',
        'health',
      ];

      for (const cmdName of requiredCommands) {
        const cmd = commandRegistry.getCommand(cmdName);
        expect(cmd, `Command /${cmdName} must be registered`).toBeDefined();
        expect(cmd?.command).toBe(cmdName);
        expect(cmd?.description.length).toBeGreaterThan(0);
      }

      expect(commandRegistry.getCommands().length).toBe(14);
    });

    it('marks /pause, /resume, and /settings as sensitive commands', () => {
      const sensitiveCommands = ['pause', 'resume', 'settings'];
      for (const cmdName of sensitiveCommands) {
        const cmd = commandRegistry.getCommand(cmdName);
        expect(cmd?.isSensitive).toBe(true);
      }

      const nonSensitiveCommands = ['start', 'help', 'status', 'paper', 'balance', 'pnl', 'health'];
      for (const cmdName of nonSensitiveCommands) {
        const cmd = commandRegistry.getCommand(cmdName);
        expect(cmd?.isSensitive).toBeUndefined();
      }
    });

    it('executes /start and provides safety overview', async () => {
      const cmd = commandRegistry.getCommand('start')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('PumpSentinel Solana Sentinel Online');
      expect(replyOutput).toContain('Simulated Paper-Trading Only');
      expect(replyOutput).toContain('Zero Real Funds');
    });

    it('executes /help and lists command reference', async () => {
      const cmd = commandRegistry.getCommand('help')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('/status');
      expect(replyOutput).toContain('/pause');
      expect(replyOutput).toContain('/resume');
      expect(replyOutput).toContain('/positions');
      expect(replyOutput).toContain('/balance');
      expect(replyOutput).toContain('/pnl');
      expect(replyOutput).toContain('/inspect');
    });

    it('executes /status displaying operating mode, data-provider health, and risk rejections', async () => {
      const cmd = commandRegistry.getCommand('status')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('STRICTLY_SIMULATED_PAPER_TRADING');
      expect(replyOutput).toContain('Data-Provider Health &amp; Ingestion');
      expect(replyOutput).toContain('Token Discovery');
      expect(replyOutput).toContain('Recent Risk Rejections');
      expect(replyOutput).toContain('Portfolio Snapshot');
    });

    it('executes /paper displaying strategy and execution parameters', async () => {
      const cmd = commandRegistry.getCommand('paper')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('SIMULATED_EXECUTION_ONLY');
      expect(replyOutput).toContain('Fixed Buy Size');
      expect(replyOutput).toContain('Take-Profit Target');
      expect(replyOutput).toContain('Stop-Loss Threshold');
      expect(replyOutput).toContain('Available Capital');
    });

    it('executes /pause and /resume to engage and release global trading pause', async () => {
      const pauseCmd = commandRegistry.getCommand('pause')!;
      const resumeCmd = commandRegistry.getCommand('resume')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        username: 'sol_operator',
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      // 1. Pause
      await pauseCmd.handler(mockContext);
      expect(replyOutput).toContain('Global Trading Pause Engaged');
      expect(replyOutput).toContain('MANUAL');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(true);

      // 2. Resume
      await resumeCmd.handler(mockContext);
      expect(replyOutput).toContain('Global Trading Resumed');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(false);
    });

    it('executes /balance displaying virtual cash and risk metrics', async () => {
      const cmd = commandRegistry.getCommand('balance')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('Available Cash:');
      expect(replyOutput).toContain('Total Portfolio Equity:');
      expect(replyOutput).toContain('Current Drawdown:');
      expect(replyOutput).toContain('Total Exposure:');
    });

    it('executes /pnl displaying realized, unrealized PnL and trade metrics', async () => {
      const cmd = commandRegistry.getCommand('pnl')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('Total Combined PnL:');
      expect(replyOutput).toContain('Realized PnL:');
      expect(replyOutput).toContain('Simulated Fees Paid:');
      expect(replyOutput).toContain('Win Rate:');
    });

    it('executes /positions handling both empty and active positions', async () => {
      const cmd = commandRegistry.getCommand('positions')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: ['1'],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(
        replyOutput.includes('No active positions') ||
          replyOutput.includes('Open Simulated Positions'),
      ).toBe(true);
    });

    it('executes /top and returns formatted list or idle notice', async () => {
      const cmd = commandRegistry.getCommand('top')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: ['5'],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      // Add a test token to discovery cache
      await discoveryService.processTokenCreation({
        type: 'TOKEN_CREATED',
        mint: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        name: 'TopToken',
        symbol: 'TTK',
        creator: 'So11111111111111111111111111111111111111112',
        initialSolLiquidity: 30.0,
        bondingCurve: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
        slot: 250100500,
        signature:
          '5wvnZuL1v8M1H5H9yM6S8K9Q2P4R7T3V1W8Y5Z2A4B6C8D0E2F4G6H8J0K2L4M6N8P0R2S4T6U8V0W2X4Y6Z8A0B',
        timestamp: Date.now(),
        receivedAt: new Date(),
        uri: 'https://arweave.net/meta.json',
        source: 'solana_rpc_ws',
      });

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('Top');
      expect(replyOutput).toContain('TTK');
    });

    it('executes /inspect with validation error on invalid mint and deep analysis on valid mint', async () => {
      const cmd = commandRegistry.getCommand('inspect')!;
      let replyOutput = '';

      const mockContextBad: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: ['invalid_address_0OIl'],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContextBad);
      expect(replyOutput).toContain('Invalid Command Argument');

      const mockContextGood: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: ['SyntH11111111111111111111111111111111111111'],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContextGood);
      expect(replyOutput).toContain('Deep Token Inspection');
      expect(replyOutput).toContain('Risk Gate Decision:');
      expect(replyOutput).toContain('Safety &amp; Contract Authorities:');
    });

    it('executes /history and returns paper trading ledger history', async () => {
      const cmd = commandRegistry.getCommand('history')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: ['1'],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(
        replyOutput.includes('No trade fills recorded') ||
          replyOutput.includes('Paper Trade Ledger History'),
      ).toBe(true);
    });

    it('executes /settings and returns sanitized configuration without secrets', async () => {
      const cmd = commandRegistry.getCommand('settings')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('PumpSentinel Configuration &amp; Risk Settings');
      expect(replyOutput).toContain('Stop-Loss Threshold');
      expect(replyOutput).toContain('Take-Profit Target');
      expect(replyOutput).toContain('RPC Endpoints');
      expect(replyOutput).not.toContain('password');
      expect(replyOutput).not.toContain('secret');
    });

    it('executes /health and returns subsystem health report and RAM metrics', async () => {
      const cmd = commandRegistry.getCommand('health')!;
      let replyOutput = '';

      const mockContext: TelegramCommandContext = {
        ctx: {} as any,
        userId: 12345,
        args: [],
        replyHtml: async (html: string) => {
          replyOutput = html;
        },
      };

      await cmd.handler(mockContext);
      expect(replyOutput).toContain('System Health Report');
      expect(replyOutput).toContain('RAM Usage:');
      expect(replyOutput).toContain('Subsystem Probes:');
    });
  });

  // =========================================================================
  // 6. Telegram Bot Service
  // =========================================================================
  describe('Telegram Bot Service (bot.service)', () => {
    let botService: TelegramBotService;

    beforeEach(() => {
      botService = new TelegramBotService();
    });

    it('initializes the bot and registers command definitions', () => {
      const bot = botService.initialize(
        '123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567',
        'webhook_secret_xyz',
      );
      expect(bot).toBeDefined();
      expect(botService.getBot()).toBe(bot);
    });

    it('verifies secure webhook deployment update handler', async () => {
      botService.initialize(
        '123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567',
        'valid_webhook_secret_123',
      );

      // 1. Rejected if secret token does not match
      const rejectedResult = await botService.handleWebhookUpdate('wrong_secret', {
        update_id: 100,
      });
      expect(rejectedResult.status).toBe(403);
      expect(rejectedResult.body).toContain('Forbidden');

      // 2. Rejected if payload is invalid
      const badReqResult = await botService.handleWebhookUpdate('valid_webhook_secret_123', null);
      expect(badReqResult.status).toBe(400);

      // 3. Accepted if secret matches
      const okResult = await botService.handleWebhookUpdate('valid_webhook_secret_123', {
        update_id: 101,
      });
      expect(okResult.status).toBe(200);
    });

    it('maintains command audit records', () => {
      const logs = botService.getRecentAuditLogs(10);
      expect(Array.isArray(logs)).toBe(true);
    });

    it('rejects unauthorized users before executing any commands', async () => {
      const bot = botService.initialize('123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567', 'secret');

      const interceptedMessages: any[] = [];
      bot.api.config.use(async (_prev, method, payload) => {
        interceptedMessages.push({ method, payload });
        return {
          ok: true,
          result: { message_id: 1, date: Date.now(), chat: { id: 999999, type: 'private' } },
        } as any;
      });

      // User 999999 is NOT in authorized allowlist
      await bot.handleUpdate({
        update_id: 7771,
        message: {
          message_id: 1,
          date: Date.now(),
          chat: { id: 999999, type: 'private' },
          from: { id: 999999, is_bot: false, first_name: 'Attacker' },
          text: '/status',
          entities: [{ offset: 0, length: 7, type: 'bot_command' }],
        },
      } as any);

      expect(interceptedMessages.length).toBe(1);
      expect(interceptedMessages[0].payload.text).toContain('Unauthorized');
      expect(interceptedMessages[0].payload.text).toContain('do not have permission');

      const auditLogs = botService.getRecentAuditLogs(5);
      const unauthorizedLog = auditLogs.find((l) => l.userId === 999999);
      expect(unauthorizedLog).toBeDefined();
      expect(unauthorizedLog?.status).toBe('REJECTED_UNAUTHORIZED');
    });

    it('drops duplicate updates in middleware', async () => {
      const bot = botService.initialize('123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567', 'secret');

      const interceptedMessages: any[] = [];
      bot.api.config.use(async (_prev, method, payload) => {
        interceptedMessages.push({ method, payload });
        return {
          ok: true,
          result: { message_id: 1, date: Date.now(), chat: { id: 999999, type: 'private' } },
        } as any;
      });

      const duplicateUpdate = {
        update_id: 8888,
        message: {
          message_id: 10,
          date: Date.now(),
          chat: { id: 999999, type: 'private' },
          from: { id: 999999, is_bot: false, first_name: 'Attacker' },
          text: '/help',
          entities: [{ offset: 0, length: 5, type: 'bot_command' }],
        },
      };

      // First time: processed
      await bot.handleUpdate(duplicateUpdate as any);
      expect(interceptedMessages.length).toBe(1);

      // Second time with exact same update_id: dropped by deduplicator
      await bot.handleUpdate(duplicateUpdate as any);
      expect(interceptedMessages.length).toBe(1);
    });

    it('sanitizes secrets when broadcasting alert notifications', async () => {
      const bot = botService.initialize('123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567', 'secret');

      const sentAlerts: any[] = [];
      bot.api.config.use(async (_prev, method, payload) => {
        sentAlerts.push({ method, payload });
        return {
          ok: true,
          result: { message_id: 1, date: Date.now(), chat: { id: 1, type: 'private' } },
        } as any;
      });

      // Mock isRunning
      (botService as any).isRunning = true;

      // Ensure at least one authorized user
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'TELEGRAM_AUTHORIZED_USER_IDS') return [1234567];
        return '' as any;
      });

      await botService.send({
        id: 'notif_1',
        category: 'PORTFOLIO_RISK',
        priority: 'CRITICAL',
        title: 'Emergency Exit Failure',
        message:
          'Database connection failed: postgresql://sentinel_user:secret_password@localhost:5432/db',
        timestamp: new Date(),
      });

      expect(sentAlerts.length).toBe(1);
      expect(sentAlerts[0].payload.text).toContain('Emergency Exit Failure');
      expect(sentAlerts[0].payload.text).toContain('***REDACTED***');
      expect(sentAlerts[0].payload.text).not.toContain('secret_password');
    });
  });
});
