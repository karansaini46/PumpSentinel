import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramBotService } from '../../src/modules/telegram/bot.service.js';
import { systemStateService } from '../../src/modules/system-state/system-state.service.js';
import { systemStateRepository } from '../../src/modules/system-state/system-state.repository.js';
import { portfolioRiskController } from '../../src/modules/risk/portfolio-risk-controller.js';
import { ingestionStreamService } from '../../src/modules/ingestion/stream.service.js';
import { MockSolanaProvider } from '../../src/modules/ingestion/providers/mock-provider.js';
import { telegramRateLimiter } from '../../src/modules/telegram/telegram-rate-limiter.js';
import { telegramDeduplicator } from '../../src/modules/telegram/telegram-deduplicator.js';

describe('Telegram Commands & State Transitions Integration Tests', () => {
  let botService: TelegramBotService;
  let bot: any;
  let sentMessages: Array<{ method: string; payload: any }>;
  let updateCounter = 9000;

  const AUTHORIZED_USER_ID = 1324409422;
  const UNAUTHORIZED_USER_ID = 888888;
  const VALID_MINT = 'SyntH11111111111111111111111111111111111111';

  // Helper to send a command update to the bot and return intercepted response text
  const dispatchCommand = async (
    commandText: string,
    userId: number = AUTHORIZED_USER_ID,
    username: string = 'authorized_admin',
  ): Promise<string> => {
    updateCounter++;
    const [cmd, ..._rest] = commandText.trim().split(/\s+/);

    await bot.handleUpdate({
      update_id: updateCounter,
      message: {
        message_id: updateCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: 'private' },
        from: {
          id: userId,
          is_bot: false,
          first_name: username,
          username,
        },
        text: commandText,
        entities: [
          {
            offset: 0,
            length: cmd?.length ?? commandText.length,
            type: 'bot_command',
          },
        ],
      },
    } as any);

    // Return text of the latest sent message
    const lastMsg = sentMessages[sentMessages.length - 1];
    return lastMsg?.payload?.text ?? '';
  };

  beforeEach(async () => {
    telegramRateLimiter.reset();
    telegramDeduplicator.reset();
    sentMessages = [];
    botService = new TelegramBotService();
    bot = botService.initialize('123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567');

    // Intercept outgoing Telegram API calls
    bot.api.config.use(async (_prev: any, method: string, payload: any) => {
      sentMessages.push({ method, payload });
      return {
        ok: true,
        result: {
          message_id: updateCounter,
          date: Math.floor(Date.now() / 1000),
          chat: { id: payload.chat_id ?? AUTHORIZED_USER_ID, type: 'private' },
        },
      } as any;
    });

    // Ensure mock stream provider is in healthy connected state by default
    const mockProvider = new MockSolanaProvider();
    await mockProvider.start();
    ingestionStreamService.setProvider(mockProvider);
    await ingestionStreamService.start();

    // Reset operating state to MONITORING for test determinism
    await systemStateService.resume(AUTHORIZED_USER_ID, 'test_setup');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Explicit State Transitions (/pause, /resume, /stop, ERROR)
  // =========================================================================
  describe('State Machine & Explicit State Transitions', () => {
    it('transitions MONITORING -> PAUSED via /pause and immediately blocks entries', async () => {
      expect(systemStateService.getState()).toBe('MONITORING');

      const response = await dispatchCommand('/pause');
      expect(response).toContain('Global Trading Pause Engaged');
      expect(response).toContain('PAUSED');
      expect(systemStateService.getState()).toBe('PAUSED');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(true);

      // Verify that system status reflects PAUSED state
      const statusResponse = await dispatchCommand('/status');
      expect(statusResponse).toContain('PAUSED');
      expect(statusResponse).toContain('Global Trading Entries: <b>BLOCKED</b>');
    });

    it('rejects duplicate /pause when already in PAUSED state', async () => {
      await dispatchCommand('/pause');
      expect(systemStateService.getState()).toBe('PAUSED');

      const duplicateResponse = await dispatchCommand('/pause');
      expect(duplicateResponse).toContain('already in PAUSED state');
      expect(duplicateResponse).toContain('No change was made');
      expect(systemStateService.getState()).toBe('PAUSED');
    });

    it('transitions PAUSED -> MONITORING via /resume when data and risk are healthy', async () => {
      await dispatchCommand('/pause');
      expect(systemStateService.getState()).toBe('PAUSED');

      const resumeResponse = await dispatchCommand('/resume');
      expect(resumeResponse).toContain('Global Trading Resumed');
      expect(resumeResponse).toContain('MONITORING');
      expect(systemStateService.getState()).toBe('MONITORING');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(false);
    });

    it('rejects duplicate /resume when already in MONITORING state', async () => {
      expect(systemStateService.getState()).toBe('MONITORING');

      const duplicateResponse = await dispatchCommand('/resume');
      expect(duplicateResponse).toContain('already in MONITORING state');
      expect(duplicateResponse).toContain('No change was made');
      expect(systemStateService.getState()).toBe('MONITORING');
    });

    it('transitions MONITORING -> STOPPED via /stop, stops stream and blocks new entries', async () => {
      expect(systemStateService.getState()).toBe('MONITORING');

      const stopResponse = await dispatchCommand('/stop');
      expect(stopResponse).toContain('Operating State: STOPPED');
      expect(stopResponse).toContain('Ingestion Stream:</b> <b>STOPPED</b>');
      expect(stopResponse).toContain('New Entries:</b> <b>STRICTLY BLOCKED</b>');
      expect(systemStateService.getState()).toBe('STOPPED');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(true);
    });

    it('rejects duplicate /stop when already in STOPPED state', async () => {
      await dispatchCommand('/stop');
      expect(systemStateService.getState()).toBe('STOPPED');

      const duplicateResponse = await dispatchCommand('/stop');
      expect(duplicateResponse).toContain('already in STOPPED state');
      expect(duplicateResponse).toContain('No change was made');
      expect(systemStateService.getState()).toBe('STOPPED');
    });

    it('transitions STOPPED -> MONITORING via /resume with preconditions verified', async () => {
      await dispatchCommand('/stop');
      expect(systemStateService.getState()).toBe('STOPPED');

      const resumeResponse = await dispatchCommand('/resume');
      expect(resumeResponse).toContain('Global Trading Resumed');
      expect(resumeResponse).toContain('MONITORING');
      expect(systemStateService.getState()).toBe('MONITORING');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(false);
      expect(ingestionStreamService.running).toBe(true);
    });

    it('transitions to ERROR state upon critical failure and can recover via /resume', async () => {
      await systemStateService.setError('Simulated critical crash in worker thread', {
        source: 'sentinel_watchdog',
      });
      expect(systemStateService.getState()).toBe('ERROR');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(true);

      const statusResponse = await dispatchCommand('/status');
      expect(statusResponse).toContain('ERROR');

      // Operator resolves issue and issues /resume
      const resumeResponse = await dispatchCommand('/resume');
      expect(resumeResponse).toContain('Global Trading Resumed');
      expect(systemStateService.getState()).toBe('MONITORING');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(false);
    });
  });

  // =========================================================================
  // 2. Precondition Validation for /resume (Requirement 3)
  // =========================================================================
  describe('/resume Precondition Verification', () => {
    it('blocks /resume when data provider is unhealthy (ERROR status)', async () => {
      await dispatchCommand('/pause');
      expect(systemStateService.getState()).toBe('PAUSED');

      // Unhealthy provider
      const badProvider = new MockSolanaProvider();
      vi.spyOn(badProvider, 'getHealth').mockReturnValue({
        ...badProvider.getHealth(),
        name: 'BrokenProvider',
        status: 'ERROR',
      });
      ingestionStreamService.setProvider(badProvider);

      const resumeResponse = await dispatchCommand('/resume');
      expect(resumeResponse).toContain('Cannot Resume Global Operations');
      expect(resumeResponse).toContain('Data provider BrokenProvider is in ERROR status');
      expect(systemStateService.getState()).toBe('PAUSED');
    });

    it('blocks /resume when risk configuration is invalid (stopLoss outside bounds)', async () => {
      await dispatchCommand('/pause');
      expect(systemStateService.getState()).toBe('PAUSED');

      // Corrupt risk configuration
      vi.spyOn(portfolioRiskController, 'getConfig').mockReturnValue({
        stopLossPct: 999, // Invalid (>50%)
        takeProfitPct: 20,
        maxHoldingDurationMs: 300000,
        maxDailyLossPct: 10,
        maxDrawdownPct: 15,
        maxPositionSizeSol: 1.0,
        maxConcurrentPositions: 5,
        maxTotalExposurePct: 80,
        maxTotalExposureSol: 4.0,
        solPriceUsd: 160,
      } as any);

      const resumeResponse = await dispatchCommand('/resume');
      expect(resumeResponse).toContain('Cannot Resume Global Operations');
      expect(resumeResponse).toContain('Invalid stop-loss');
      expect(systemStateService.getState()).toBe('PAUSED');
    });
  });

  // =========================================================================
  // 3. Position Monitoring Policy After Stopping (Requirement 5)
  // =========================================================================
  describe('Position Monitoring Policy After Stopping', () => {
    it('guarantees existing paper positions remain protected by stop-loss & take-profit exits in STOPPED mode', async () => {
      await dispatchCommand('/stop');
      expect(systemStateService.getState()).toBe('STOPPED');

      const statusResponse = await dispatchCommand('/status');
      // Verify Requirement 5 policy string
      expect(statusResponse).toContain('PROTECTED DORMANT');
      expect(statusResponse).toContain(
        'Existing paper positions remain guarded by stop-loss, take-profit',
      );

      // Verify that risk controller pause allows exit management
      const policyDetails = systemStateService.getPositionMonitoringPolicy();
      expect(policyDetails).toContain('Protected Dormant');
    });
  });

  // =========================================================================
  // 4. Authorization & Security Enforcement (Requirements 1, No Real-Money)
  // =========================================================================
  describe('Authorization & Security Controls', () => {
    it('rejects unauthorized users before executing any command', async () => {
      const response = await dispatchCommand('/pause', UNAUTHORIZED_USER_ID, 'attacker');
      expect(response).toContain('Unauthorized');
      expect(response).toContain('do not have permission');
      expect(systemStateService.getState()).toBe('MONITORING');
    });

    it('rejects unauthorized users attempting state change commands', async () => {
      const unauthorizedCommands = [
        '/pause',
        '/resume',
        '/stop',
        '/set stop_loss 12',
        '/confirm 123',
        '/settings',
      ];
      for (const cmd of unauthorizedCommands) {
        const response = await dispatchCommand(cmd, UNAUTHORIZED_USER_ID, 'attacker');
        expect(response).toContain('Unauthorized');
      }
    });

    it('strictly forbids any command attempting to enable real-money trading or supply keys', async () => {
      // 1. Attempt to set real money
      const realMoneyAttempt1 = await dispatchCommand('/set real_money true');
      expect(realMoneyAttempt1).toContain('Security Violation');
      expect(realMoneyAttempt1).toContain('No Telegram command may enable real-money trading');

      // 2. Attempt to supply private key
      const keyAttempt = await dispatchCommand('/set solana_private_key 5KxyzSecret123');
      expect(keyAttempt).toContain('Security Violation');

      // 3. Attempt to disable paper mode
      const paperAttempt = await dispatchCommand('/set paper_mode false');
      expect(paperAttempt).toContain('Security Violation');
    });
  });

  // =========================================================================
  // 5. Input Validation & Token Inspection (Requirements 6, 9)
  // =========================================================================
  describe('Input Validation & Token Inspection', () => {
    it('/inspect accepts and analyses a valid Base58 Solana mint address', async () => {
      const response = await dispatchCommand(`/inspect ${VALID_MINT}`);
      expect(response).toContain('Deep Token Inspection');
      expect(response).toContain(VALID_MINT);
      expect(response).toContain('Liquidity &amp; Market Depth:');
    });

    it('/inspect rejects invalid or malformed mint addresses safely', async () => {
      // Missing argument
      const emptyArgResponse = await dispatchCommand('/inspect');
      expect(emptyArgResponse).toContain('Invalid Command Argument');

      // Too short
      const shortArgResponse = await dispatchCommand('/inspect abc123');
      expect(shortArgResponse).toContain('Invalid Command Argument');
      expect(shortArgResponse).toContain('Solana mint address must be at least 32 characters');

      // Forbidden Base58 characters (0, O, I, l)
      const invalidCharsResponse = await dispatchCommand(
        '/inspect 0OIl6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBE',
      );
      expect(invalidCharsResponse).toContain('Invalid Command Argument');
    });

    it('rejects unknown commands safely without crashing', async () => {
      const response = await dispatchCommand('/unknown_nonexistent_cmd');
      expect(response).toContain('Unknown command');
      expect(response).toContain('Type /help to see all available commands');

      const auditLogs = botService.getRecentAuditLogs(5);
      const unknownLog = auditLogs.find((l) => l.command === 'unknown_nonexistent_cmd');
      expect(unknownLog).toBeDefined();
      expect(unknownLog?.status).toBe('UNKNOWN_COMMAND');
    });

    it('rejects malformed arguments for /top safely', async () => {
      const response = await dispatchCommand('/top not_a_number');
      expect(response).toContain('Invalid Command Argument');
    });

    it('rejects out-of-range pagination arguments for /positions safely', async () => {
      const response = await dispatchCommand('/positions -1');
      expect(response).toContain('Invalid Command Argument');
    });
  });

  // =========================================================================
  // 6. Two-Phase Configuration Changes (Requirements 7, 8)
  // =========================================================================
  describe('Configuration Changes & Two-Phase Confirmation', () => {
    it('/settings displays complete sanitized risk limits and strategy bounds', async () => {
      const response = await dispatchCommand('/settings');
      expect(response).toContain('PumpSentinel Configuration &amp; Risk Settings');
      expect(response).toContain('Stop-Loss Threshold');
      expect(response).toContain('Take-Profit Target');
      expect(response).toContain('max_holding_time_sec');
      expect(response).toContain('max_daily_loss');
      expect(response).toContain('max_drawdown');
      expect(response).toContain('max_position_size');
      expect(response).toContain('max_concurrent_positions');
      expect(response).toContain('max_total_exposure_pct');
      expect(response).toContain('RPC Endpoints');
      expect(response).toContain('***REDACTED***'); // Zero secrets exposed
    });

    it('validates and proposes configuration change requiring explicit /confirm token', async () => {
      // 1. Propose stop_loss change to 12%
      const proposeResponse = await dispatchCommand('/set stop_loss 12');
      expect(proposeResponse).toContain('Configuration Change Confirmation Required');
      expect(proposeResponse).toContain('stop_loss');
      expect(proposeResponse).toContain('Proposed Value:</b> <b>12</b>');
      expect(proposeResponse).toContain('/confirm');

      // Extract confirmation token from response
      const tokenMatch = proposeResponse.match(/<code>(cfg_[a-f0-9]{8})<\/code>/);
      expect(tokenMatch).not.toBeNull();
      const token = tokenMatch![1];

      // 2. Confirm change with token
      const confirmResponse = await dispatchCommand(`/confirm ${token}`);
      expect(confirmResponse).toContain('Configuration Updated Successfully');
      expect(confirmResponse).toContain('stop_loss');
      expect(confirmResponse).toContain('12');

      // Verify that in-memory risk controller updated
      expect(portfolioRiskController.getConfig().stopLossPct).toBe(12);

      // Verify token cannot be reused
      const replayConfirm = await dispatchCommand(`/confirm ${token}`);
      expect(replayConfirm).toContain('Invalid or Expired Token');
    });

    it('rejects out-of-range configuration values on /set proposal', async () => {
      // Stop loss > 50%
      const invalidResponse = await dispatchCommand('/set stop_loss 75');
      expect(invalidResponse).toContain('Invalid Value for stop_loss');
      expect(invalidResponse).toContain('Stop-loss cannot exceed 50%');

      // Max holding time < 10s
      const invalidHolding = await dispatchCommand('/set max_holding_time_sec 2');
      expect(invalidHolding).toContain('Invalid Value for max_holding_time_sec');
      expect(invalidHolding).toContain('Holding time must be at least 10 seconds');

      // Unknown parameter
      const unknownParam = await dispatchCommand('/set nonexistent_param 123');
      expect(unknownParam).toContain('Unknown Parameter');
    });

    it('/cancel discards pending proposed configuration changes', async () => {
      const proposeResponse = await dispatchCommand('/set take_profit 35');
      expect(proposeResponse).toContain('Configuration Change Confirmation Required');

      const tokenMatch = proposeResponse.match(/<code>(cfg_[a-f0-9]{8})<\/code>/);
      const token = tokenMatch![1];

      const cancelResponse = await dispatchCommand('/cancel');
      expect(cancelResponse).toContain('Cancelled');
      expect(cancelResponse).toContain('pending configuration change(s) discarded');

      // Subsequent confirmation must fail
      const confirmResponse = await dispatchCommand(`/confirm ${token}`);
      expect(confirmResponse).toContain('Invalid or Expired Token');
    });
  });

  // =========================================================================
  // 7. Concurrency Lock & Command Race Prevention (Requirement 10)
  // =========================================================================
  describe('Concurrency Lock & Race Prevention', () => {
    it('prevents concurrent overlapping state transitions via transition lock', async () => {
      // Artificially activate transition lock
      (systemStateService as any).isTransitioning = true;

      try {
        const raceResponse = await dispatchCommand('/pause');
        expect(raceResponse).toContain('Another state transition is currently in progress');
      } finally {
        (systemStateService as any).isTransitioning = false;
      }
    });

    it('drops duplicate update payloads to prevent replay attacks', async () => {
      const dupUpdate = {
        update_id: 99999,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: AUTHORIZED_USER_ID, type: 'private' },
          from: { id: AUTHORIZED_USER_ID, is_bot: false, first_name: 'Operator' },
          text: '/balance',
          entities: [{ offset: 0, length: 8, type: 'bot_command' }],
        },
      };

      const initialCount = sentMessages.length;
      await bot.handleUpdate(dupUpdate as any);
      expect(sentMessages.length).toBe(initialCount + 1);

      // Replayed identical update
      await bot.handleUpdate(dupUpdate as any);
      expect(sentMessages.length).toBe(initialCount + 1); // No new message sent
    });
  });

  // =========================================================================
  // 8. State Persistence & Audit Trail (Requirements 11, 12)
  // =========================================================================
  describe('Persistence Across Restarts & Control Audit Trail', () => {
    it('persists operating state across restarts to storage file', async () => {
      // 1. Transition to STOPPED
      await dispatchCommand('/stop');
      expect(systemStateService.getState()).toBe('STOPPED');

      // 2. Read saved state directly from disk
      const saved = await systemStateRepository.loadState();
      expect(saved).not.toBeNull();
      expect(saved?.state).toBe('STOPPED');
      expect(saved?.updatedBy.userId).toBe(AUTHORIZED_USER_ID);

      // 3. Simulate process restart by calling systemStateService.init()
      await systemStateService.init();
      expect(systemStateService.getState()).toBe('STOPPED');
      expect(portfolioRiskController.getPauseDetails().isPaused).toBe(true);
    });

    it('records an audit trail for every control action', async () => {
      await dispatchCommand('/pause');
      await dispatchCommand('/resume');

      const auditRecords = await systemStateRepository.getRecentAuditRecords(10);
      expect(auditRecords.length).toBeGreaterThanOrEqual(2);

      const pauseAudit = auditRecords.find((r) => r.command === 'pause');
      expect(pauseAudit).toBeDefined();
      expect(pauseAudit?.userId).toBe(AUTHORIZED_USER_ID);
      expect(pauseAudit?.status).toBe('SUCCESS');

      const resumeAudit = auditRecords.find((r) => r.command === 'resume');
      expect(resumeAudit).toBeDefined();
      expect(resumeAudit?.userId).toBe(AUTHORIZED_USER_ID);
      expect(resumeAudit?.status).toBe('SUCCESS');
    });
  });
});
