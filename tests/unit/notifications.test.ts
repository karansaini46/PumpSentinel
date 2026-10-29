import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  formatTokenAlert,
  formatTradeAlert,
  formatSystemAlert,
  formatTokenBatch,
} from '../../src/modules/notifications/notification-formatter.js';
import { NotificationQueue } from '../../src/modules/notifications/notification-queue.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import type {
  TokenAlertPayload,
  SimulatedTradeAlertPayload,
  SystemAlertPayload,
  SentinelNotification,
  INotificationChannel,
} from '../../src/modules/notifications/notifications.types.js';

describe('Event-Driven Telegram Notifications Module', () => {
  // =========================================================================
  // 1. Notification Formatter Tests
  // =========================================================================
  describe('Notification Formatter (notification-formatter)', () => {
    const baseToken: TokenAlertPayload = {
      mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      symbol: 'MOONCAT',
      name: 'Moon Cat Token',
      discoveryTimestamp: new Date('2026-10-29T12:00:00.000Z'),
      creator: '4Nd1mBQtrMKBCPMPR8RnhbYF1wzLh2rSGBR4P5LwYV9x',
      liquiditySol: 30.5,
      dataFreshnessMs: 42,
      riskScore: 25,
      riskSummary: 'Safe Dev Holdings, Verified Bonding Curve',
      decision: 'DISCOVERED',
      decisionReason: 'On-chain pump.fun migration stream',
      marketDataSource: 'Helius WebSocket RPC',
      slot: 284910234,
    };

    describe('formatTokenAlert', () => {
      it('formats newly discovered token alert with all required fields', () => {
        const formatted = formatTokenAlert(baseToken);

        expect(formatted.category).toBe('TOKEN_ALERT');
        expect(formatted.priority).toBe('LOW');
        expect(formatted.title).toContain('[PAPER] Token DISCOVERED: MOONCAT');
        expect(formatted.html).toContain('MOONCAT');
        expect(formatted.html).toContain(baseToken.mint);
        expect(formatted.html).toContain('2026-10-29 12:00:00 UTC');
        expect(formatted.html).toContain('4Nd1mB...YV9x'); // Shortened creator
        expect(formatted.html).toContain('30.5000 SOL');
        expect(formatted.html).toContain('42ms');
        expect(formatted.html).toContain('Safe Dev Holdings, Verified Bonding Curve');
        expect(formatted.html).toContain('DISCOVERED');
        expect(formatted.html).toContain('On-chain pump.fun migration stream');
        expect(formatted.html).toContain('Helius WebSocket RPC');
      });

      it('formats risk rejection alert with REJECT decision badge', () => {
        const rejectedToken: TokenAlertPayload = {
          ...baseToken,
          decision: 'REJECT',
          decisionReason: 'High sniper concentration (48% in top 3 wallets)',
          riskScore: 88,
          riskSummary: 'CRITICAL: Sybil cluster detected',
        };

        const formatted = formatTokenAlert(rejectedToken);

        expect(formatted.category).toBe('RISK_ALERT');
        expect(formatted.priority).toBe('MEDIUM');
        expect(formatted.title).toContain('Token RISK REJECTED');
        expect(formatted.html).toContain('🔴 <b>REJECT</b>');
        expect(formatted.html).toContain('High sniper concentration');
        expect(formatted.html).toContain('Score: 88/100');
        expect(formatted.dedupeKey).toBe(`token:${baseToken.mint}:REJECT`);
      });

      it('formats strategy eligibility alert with ELIGIBLE_FOR_STRATEGY decision badge', () => {
        const eligibleToken: TokenAlertPayload = {
          ...baseToken,
          decision: 'ELIGIBLE_FOR_STRATEGY',
          decisionReason: 'Passed all safety gates and risk thresholds',
          riskScore: 12,
        };

        const formatted = formatTokenAlert(eligibleToken);

        expect(formatted.category).toBe('TOKEN_ALERT');
        expect(formatted.priority).toBe('MEDIUM');
        expect(formatted.title).toContain('Token STRATEGY ELIGIBLE');
        expect(formatted.html).toContain('🟢 <b>ELIGIBLE_FOR_STRATEGY</b>');
        expect(formatted.html).toContain('Passed all safety gates');
      });

      it('handles missing creator and synthetic badge gracefully', () => {
        const synthToken: TokenAlertPayload = {
          ...baseToken,
          creator: undefined,
          isSynthetic: true,
          dataFreshnessMs: undefined,
        };

        const formatted = formatTokenAlert(synthToken);

        expect(formatted.html).toContain('Creator: <code>Unknown</code>');
        expect(formatted.html).toContain('[SYNTHETIC]');
        expect(formatted.html).toContain('Freshness: <b>Live Stream</b>');
      });
    });

    describe('formatTradeAlert', () => {
      const baseTrade: SimulatedTradeAlertPayload = {
        tradeId: 'trade-sim-12345',
        tokenMint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        tokenSymbol: 'PEPE',
        side: 'BUY',
        stage: 'FILLED',
        executedPriceSol: 0.000045,
        executedPriceUsd: 0.00675,
        amountTokens: 25000,
        totalSol: 1.125,
        totalUsd: 168.75,
        simulatedFeeSol: 0.005,
        slippageBps: 25,
        executedAt: new Date('2026-10-29T12:05:00.000Z'),
      };

      it('Requirement 1: Never claim an order filled when it was only requested', () => {
        const requestedTrade: SimulatedTradeAlertPayload = {
          ...baseTrade,
          stage: 'REQUESTED',
          exitReason: 'Strategy entry signal triggered',
        };

        const formatted = formatTradeAlert(requestedTrade);

        expect(formatted.title).toContain('[PAPER] BUY REQUESTED: PEPE');
        expect(formatted.html).toContain('REQUESTED (Awaiting Simulation Fill)');
        expect(formatted.html).toContain('SIMULATED ORDER REQUESTED — NOT YET FILLED');
        expect(formatted.html).not.toContain('FILLED (SIMULATED)');
      });

      it('Requirement 2: Clearly label every trade as PAPER', () => {
        const filledBuy = formatTradeAlert(baseTrade);

        expect(filledBuy.title).toContain('[PAPER]');
        expect(filledBuy.html).toContain('[PAPER BUY FILLED]');
        expect(filledBuy.html).toContain('SIMULATED PAPER EXECUTION ONLY');
      });

      it('formats simulated BUY filled alert with all required metrics', () => {
        const formatted = formatTradeAlert(baseTrade);

        expect(formatted.category).toBe('TRADE_SIMULATION');
        expect(formatted.priority).toBe('HIGH');
        expect(formatted.html).toContain('PEPE');
        expect(formatted.html).toContain('BUY');
        expect(formatted.html).toContain('0.000045 SOL');
        expect(formatted.html).toContain('25,000 TOKENS');
        expect(formatted.html).toContain('1.1250 SOL');
        expect(formatted.html).toContain('0.0050 SOL');
        expect(formatted.html).toContain('25 bps');
      });

      it('formats simulated SELL filled alert with realized P&L and ROI', () => {
        const sellTrade: SimulatedTradeAlertPayload = {
          ...baseTrade,
          side: 'SELL',
          stage: 'FILLED',
          entryPriceSol: 0.00004,
          exitPriceSol: 0.00005,
          executedPriceSol: 0.00005,
          totalSol: 1.25,
          realizedPnlSol: 0.125,
          realizedPnlPct: 11.11,
          exitReason: 'Manual profit harvest',
        };

        const formatted = formatTradeAlert(sellTrade);

        expect(formatted.title).toContain('[PAPER] SELL FILLED: PEPE');
        expect(formatted.html).toContain('Entry Price: <code>0.000040 SOL</code>');
        expect(formatted.html).toContain('Exit Price: <code>0.000050 SOL</code>');
        expect(formatted.html).toContain('+0.1250 SOL');
        expect(formatted.html).toContain('+11.11%');
        expect(formatted.html).toContain('Manual profit harvest');
      });

      it('formats Stop-Loss trigger alert with dedicated badge and icon', () => {
        const slTrade: SimulatedTradeAlertPayload = {
          ...baseTrade,
          side: 'SELL',
          stage: 'FILLED',
          exitReason: 'Stop-loss triggered at -10.5% threshold',
          realizedPnlSol: -0.118,
          realizedPnlPct: -10.5,
        };

        const formatted = formatTradeAlert(slTrade);

        expect(formatted.title).toContain('STOP-LOSS TRIGGERED');
        expect(formatted.html).toContain('STOP-LOSS TRIGGERED');
        expect(formatted.html).toContain('-0.1180 SOL');
        expect(formatted.html).toContain('-10.50%');
      });

      it('formats Take-Profit trigger alert with dedicated badge and icon', () => {
        const tpTrade: SimulatedTradeAlertPayload = {
          ...baseTrade,
          side: 'SELL',
          stage: 'FILLED',
          exitReason: 'Take-profit target hit (+20.0%)',
          realizedPnlSol: 0.225,
          realizedPnlPct: 20.0,
        };

        const formatted = formatTradeAlert(tpTrade);

        expect(formatted.title).toContain('TAKE-PROFIT TRIGGERED');
        expect(formatted.html).toContain('TAKE-PROFIT TRIGGERED');
        expect(formatted.html).toContain('+0.2250 SOL');
        expect(formatted.html).toContain('+20.00%');
      });

      it('formats Emergency Exit alert with CRITICAL priority and emergency badge', () => {
        const emTrade: SimulatedTradeAlertPayload = {
          ...baseTrade,
          side: 'SELL',
          stage: 'FILLED',
          exitReason: 'Emergency exit: Severe liquidity collapse detected',
          realizedPnlSol: -0.45,
          realizedPnlPct: -40.0,
        };

        const formatted = formatTradeAlert(emTrade);

        expect(formatted.priority).toBe('CRITICAL');
        expect(formatted.title).toContain('EMERGENCY EXIT FILLED');
        expect(formatted.html).toContain('EMERGENCY EXIT FILLED');
        expect(formatted.html).toContain('Severe liquidity collapse detected');
      });
    });

    describe('formatSystemAlert', () => {
      it('formats Provider Outage as CRITICAL alert', () => {
        const payload: SystemAlertPayload = {
          type: 'PROVIDER_OUTAGE',
          title: 'Helius WebSocket Disconnected',
          details: 'Connection lost after 5 consecutive ping timeouts',
          subsystem: 'IngestionStream',
          error: 'ECONNRESET: socket hang up',
          timestamp: new Date('2026-10-29T12:10:00.000Z'),
        };

        const formatted = formatSystemAlert(payload);

        expect(formatted.priority).toBe('CRITICAL');
        expect(formatted.title).toContain('DATA PROVIDER OUTAGE DETECTED');
        expect(formatted.html).toContain('IngestionStream');
        expect(formatted.html).toContain('ECONNRESET');
      });

      it('formats Daily Loss-Limit trigger as CRITICAL alert', () => {
        const payload: SystemAlertPayload = {
          type: 'DAILY_LOSS_LIMIT',
          title: 'Daily Loss Limit Breached',
          details: 'Daily loss hit 5.2% of starting daily equity (Limit: 5.0%)',
          subsystem: 'PortfolioRiskController',
          metrics: {
            startingEquitySol: 100.0,
            dailyLossSol: 5.2,
            dailyLossPct: '5.20%',
          },
          timestamp: new Date('2026-10-29T12:15:00.000Z'),
        };

        const formatted = formatSystemAlert(payload);

        expect(formatted.priority).toBe('CRITICAL');
        expect(formatted.title).toContain('DAILY SIMULATED LOSS LIMIT BREACHED');
        expect(formatted.html).toContain('PortfolioRiskController');
        expect(formatted.html).toContain('dailyLossPct: <b>5.20%</b>');
      });

      it('formats Stale Critical Market Data as HIGH priority alert', () => {
        const payload: SystemAlertPayload = {
          type: 'STALE_MARKET_DATA',
          title: 'Stale Price Feed for Active Position',
          details: 'No price updates received for mint 7xKX...gAsU in 35 seconds',
          subsystem: 'RiskMonitor',
          metrics: {
            staleAgeSeconds: 35,
            maxAllowedSeconds: 15,
          },
          timestamp: new Date('2026-10-29T12:20:00.000Z'),
        };

        const formatted = formatSystemAlert(payload);

        expect(formatted.priority).toBe('HIGH');
        expect(formatted.title).toContain('STALE CRITICAL MARKET DATA');
        expect(formatted.html).toContain('staleAgeSeconds: <b>35</b>');
      });

      it('formats Paper-Trading Reconciliation Error as CRITICAL alert', () => {
        const payload: SystemAlertPayload = {
          type: 'RECONCILIATION_ERROR',
          title: 'Virtual Cash Balance Mismatch',
          details: 'Inconsistency detected between DB position records and virtual cash ledger',
          subsystem: 'PaperReconciler',
          metrics: {
            dbCashSol: 98.45,
            inMemoryCashSol: 97.2,
            discrepancySol: 1.25,
          },
          timestamp: new Date('2026-10-29T12:25:00.000Z'),
        };

        const formatted = formatSystemAlert(payload);

        expect(formatted.priority).toBe('CRITICAL');
        expect(formatted.title).toContain('PAPER-TRADING RECONCILIATION ERROR');
        expect(formatted.html).toContain('discrepancySol: <b>1.25</b>');
      });
    });

    describe('formatTokenBatch', () => {
      it('Requirement 6: Batches low-priority tokens into a consolidated summary', () => {
        const tokens: TokenAlertPayload[] = [
          { ...baseToken, mint: 'mint111111111111111111111111111111111111111', symbol: 'TOKEN1' },
          { ...baseToken, mint: 'mint222222222222222222222222222222222222222', symbol: 'TOKEN2' },
          { ...baseToken, mint: 'mint333333333333333333333333333333333333333', symbol: 'TOKEN3' },
        ];

        const batch = formatTokenBatch(tokens);

        expect(batch.priority).toBe('LOW');
        expect(batch.title).toContain('Batch: 3 New Tokens Discovered');
        expect(batch.html).toContain('Batch Discovery Update (3 Tokens)');
        expect(batch.html).toContain('1. TOKEN1');
        expect(batch.html).toContain('2. TOKEN2');
        expect(batch.html).toContain('3. TOKEN3');
        expect(batch.html).toContain('Low-priority alerts batched');
      });

      it('shows overflow summary when tokens exceed 8 items', () => {
        const tokens: TokenAlertPayload[] = Array.from({ length: 12 }, (_, i) => ({
          ...baseToken,
          mint: `mint${i}111111111111111111111111111111111111111`,
          symbol: `SYM${i}`,
        }));

        const batch = formatTokenBatch(tokens);

        expect(batch.title).toContain('Batch: 12 New Tokens Discovered');
        expect(batch.html).toContain('...and 4 more tokens');
      });
    });
  });

  // =========================================================================
  // 2. Notification Queue Tests
  // =========================================================================
  describe('Notification Queue (notification-queue)', () => {
    let queue: NotificationQueue;

    beforeEach(() => {
      queue = new NotificationQueue({
        maxRetries: 3,
        baseRetryDelayMs: 10,
        maxRetryDelayMs: 50,
        rateLimitMinIntervalMs: 10,
        globalRateLimitPerSec: 100, // fast for testing
        batchIntervalMs: 200,
        batchMaxItems: 3,
        dedupeTtlMs: 5000,
        quietHours: {
          enabled: false,
          startHourUtc: 22,
          endHourUtc: 7,
          allowCritical: true,
          allowHigh: true,
        },
      });
    });

    afterEach(() => {
      queue.stop();
      queue.clear();
    });

    it('Requirement 3: Deduplicates identical notifications within TTL', async () => {
      const dispatched: SentinelNotification[] = [];
      queue.setHandler(async (notif) => {
        dispatched.push(notif);
      });

      const notif1: SentinelNotification = {
        id: '1',
        category: 'SYSTEM_ALERT',
        priority: 'HIGH',
        title: 'Network High Latency',
        message: 'Ping latency spiked to 450ms',
        timestamp: new Date(),
        dedupeKey: 'sys:latency:high',
      };

      const notif2: SentinelNotification = {
        id: '2',
        category: 'SYSTEM_ALERT',
        priority: 'HIGH',
        title: 'Network High Latency',
        message: 'Ping latency spiked to 450ms',
        timestamp: new Date(),
        dedupeKey: 'sys:latency:high',
      };

      const enqueued1 = await queue.enqueue(notif1);
      const enqueued2 = await queue.enqueue(notif2);

      expect(enqueued1).toBe(true);
      expect(enqueued2).toBe(false); // Dropped as duplicate

      // Wait a moment for queue processing
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatched.length).toBe(1);
    });

    it('Requirement 7: CRITICAL alerts preempt queued non-critical alerts', async () => {
      const dispatched: string[] = [];
      queue.setHandler(async (notif) => {
        await new Promise((r) => setTimeout(r, 20));
        dispatched.push(notif.priority);
      });

      const lowNotif1: SentinelNotification = {
        id: 'low-1',
        category: 'SYSTEM_HEALTH',
        priority: 'LOW',
        title: 'Routine Health Ping 1',
        message: 'All systems green',
        timestamp: new Date(),
      };

      const lowNotif2: SentinelNotification = {
        id: 'low-2',
        category: 'SYSTEM_HEALTH',
        priority: 'LOW',
        title: 'Routine Health Ping 2',
        message: 'All systems green',
        timestamp: new Date(),
      };

      const critNotif: SentinelNotification = {
        id: 'crit-1',
        category: 'SYSTEM_ALERT',
        priority: 'CRITICAL',
        title: 'EMERGENCY EXIT',
        message: 'Emergency exit in progress',
        timestamp: new Date(),
      };

      // Enqueue lowNotif1 (starts processing), then lowNotif2, then critNotif
      await queue.enqueue(lowNotif1);
      await queue.enqueue(lowNotif2);
      await queue.enqueue(critNotif);

      await new Promise((r) => setTimeout(r, 150));

      // Critical alert preempts lowNotif2 in the queue
      expect(dispatched).toEqual(['LOW', 'CRITICAL', 'LOW']);
    });

    it('Requirement 8: Quiet hours suppresses noncritical alerts but never CRITICAL', () => {
      queue.updateConfig({
        quietHours: {
          enabled: true,
          startHourUtc: 22,
          endHourUtc: 7,
          allowCritical: true,
          allowHigh: false,
        },
      });

      // Midnight time: 02:00 UTC (in quiet period)
      const quietTime = new Date('2026-10-29T02:00:00.000Z');
      expect(queue.isQuietHours(quietTime)).toBe(true);

      // Invariant: CRITICAL is NEVER suppressed
      expect(queue.shouldSuppressForQuietHours('CRITICAL', quietTime)).toBe(false);
      // HIGH is suppressed because allowHigh = false
      expect(queue.shouldSuppressForQuietHours('HIGH', quietTime)).toBe(true);
      // MEDIUM and LOW are suppressed
      expect(queue.shouldSuppressForQuietHours('MEDIUM', quietTime)).toBe(true);
      expect(queue.shouldSuppressForQuietHours('LOW', quietTime)).toBe(true);

      // Outside quiet period: 14:00 UTC
      const daytime = new Date('2026-10-29T14:00:00.000Z');
      expect(queue.isQuietHours(daytime)).toBe(false);
      expect(queue.shouldSuppressForQuietHours('LOW', daytime)).toBe(false);
      expect(queue.shouldSuppressForQuietHours('MEDIUM', daytime)).toBe(false);
      expect(queue.shouldSuppressForQuietHours('HIGH', daytime)).toBe(false);
      expect(queue.shouldSuppressForQuietHours('CRITICAL', daytime)).toBe(false);
    });

    it('Requirement 8: Handles intra-day quiet hours ranges', () => {
      queue.updateConfig({
        quietHours: {
          enabled: true,
          startHourUtc: 13,
          endHourUtc: 17,
          allowCritical: true,
          allowHigh: true,
        },
      });

      const inRange = new Date('2026-10-29T15:00:00.000Z');
      const outOfRange = new Date('2026-10-29T18:00:00.000Z');

      expect(queue.isQuietHours(inRange)).toBe(true);
      expect(queue.isQuietHours(outOfRange)).toBe(false);
    });

    it('Requirement 6: Buffers low-priority tokens and flushes on threshold', async () => {
      const dispatched: SentinelNotification[] = [];
      queue.setHandler(async (notif) => {
        dispatched.push(notif);
      });

      const token1: TokenAlertPayload = {
        mint: 'mintA',
        symbol: 'A',
        discoveryTimestamp: new Date(),
        liquiditySol: 10,
        decision: 'DISCOVERED',
        decisionReason: 'Stream',
        marketDataSource: 'Helius',
      };
      const token2: TokenAlertPayload = {
        mint: 'mintB',
        symbol: 'B',
        discoveryTimestamp: new Date(),
        liquiditySol: 20,
        decision: 'DISCOVERED',
        decisionReason: 'Stream',
        marketDataSource: 'Helius',
      };
      const token3: TokenAlertPayload = {
        mint: 'mintC',
        symbol: 'C',
        discoveryTimestamp: new Date(),
        liquiditySol: 30,
        decision: 'DISCOVERED',
        decisionReason: 'Stream',
        marketDataSource: 'Helius',
      };

      queue.enqueueBatchToken(token1);
      expect(queue.getBatchBufferSize()).toBe(1);

      queue.enqueueBatchToken(token2);
      expect(queue.getBatchBufferSize()).toBe(2);

      // 3rd item triggers batch threshold (batchMaxItems: 3)
      queue.enqueueBatchToken(token3);
      expect(queue.getBatchBufferSize()).toBe(0);

      await new Promise((r) => setTimeout(r, 60));
      expect(dispatched.length).toBe(1);
      expect(dispatched[0]?.title).toContain('Batch: 3 New Tokens Discovered');
    });

    it('Requirement 4: Retries with bounded backoff and honors Telegram retry_after', async () => {
      let attempts = 0;
      queue.setHandler(async () => {
        attempts += 1;
        if (attempts < 3) {
          // Simulate Telegram 429 rate limit
          const err = Object.assign(new Error('Telegram 429 Too Many Requests'), {
            parameters: { retry_after: 0.02 },
          });
          throw err;
        }
      });

      const notif: SentinelNotification = {
        id: 'retry-test',
        category: 'RISK_ALERT',
        priority: 'MEDIUM',
        title: 'Risk Alert Retry',
        message: 'Testing retries',
        timestamp: new Date(),
      };

      await queue.enqueue(notif);

      // Wait for backoff retries to succeed
      await new Promise((r) => setTimeout(r, 300));
      expect(attempts).toBe(3);
    });

    it('calculates backoff delay correctly with exponential scaling and retry_after', () => {
      // 1. From Telegram parameters.retry_after
      const errWithSec = { parameters: { retry_after: 15 } };
      const delaySec = queue.calculateBackoffDelay(errWithSec, 1);
      expect(delaySec).toBeGreaterThanOrEqual(15000);
      expect(delaySec).toBeLessThan(16000);

      // 2. Exponential backoff
      const expDelay1 = queue.calculateBackoffDelay(new Error('Network error'), 1);
      expect(expDelay1).toBeGreaterThanOrEqual(10); // baseRetryDelayMs: 10
      expect(expDelay1).toBeLessThanOrEqual(50); // maxRetryDelayMs: 50
    });
  });

  // =========================================================================
  // 3. Notifications Service Tests (All 12 Triggers)
  // =========================================================================
  describe('Notifications Service (notifications.service)', () => {
    let service: NotificationsService;
    let mockQueue: NotificationQueue;
    let mockChannel: INotificationChannel;
    let sentNotifications: SentinelNotification[];

    beforeEach(() => {
      sentNotifications = [];
      mockChannel = {
        send: vi.fn(async (n: SentinelNotification) => {
          sentNotifications.push(n);
        }),
      };

      mockQueue = new NotificationQueue({
        maxRetries: 2,
        baseRetryDelayMs: 5,
        maxRetryDelayMs: 20,
        rateLimitMinIntervalMs: 5,
        globalRateLimitPerSec: 200,
        batchIntervalMs: 100,
        batchMaxItems: 5,
        dedupeTtlMs: 2000,
        quietHours: {
          enabled: false,
          startHourUtc: 22,
          endHourUtc: 7,
          allowCritical: true,
          allowHigh: true,
        },
      });

      service = new NotificationsService(50, mockQueue);
      service.registerChannel(mockChannel);
    });

    afterEach(() => {
      mockQueue.stop();
      mockQueue.clear();
    });

    const mockToken: TokenAlertPayload = {
      mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      symbol: 'DOGE2',
      discoveryTimestamp: new Date(),
      creator: 'CreatorAddress11111111111111111111111111111',
      liquiditySol: 25.0,
      dataFreshnessMs: 55,
      riskScore: 20,
      riskSummary: 'Clean bonding curve',
      decision: 'DISCOVERED',
      decisionReason: 'New token launch',
      marketDataSource: 'Helius WebSocket',
    };

    const mockTrade: SimulatedTradeAlertPayload = {
      tradeId: 't-123',
      tokenMint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      tokenSymbol: 'DOGE2',
      side: 'BUY',
      stage: 'FILLED',
      executedPriceSol: 0.0001,
      amountTokens: 10000,
      totalSol: 1.0,
      simulatedFeeSol: 0.005,
      slippageBps: 20,
      executedAt: new Date(),
    };

    const mockSystem: SystemAlertPayload = {
      type: 'PROVIDER_OUTAGE',
      title: 'Provider Offline',
      details: 'Connection lost to RPC node',
      subsystem: 'HeliusProvider',
      timestamp: new Date(),
    };

    it('Trigger 1: notifyTokenDiscovered (unbatched dispatch)', async () => {
      await service.notifyTokenDiscovered(mockToken, { batch: false });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.title).toContain('[PAPER] Token DISCOVERED: DOGE2');
    });

    it('Trigger 2: notifyRiskRejected', async () => {
      await service.notifyRiskRejected({
        ...mockToken,
        decisionReason: 'Excessive developer holdings (62%)',
        riskScore: 95,
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.title).toContain('Token RISK REJECTED');
      expect(sentNotifications[0]?.message).toContain('Excessive developer holdings');
    });

    it('Trigger 3: notifyStrategyEligible', async () => {
      await service.notifyStrategyEligible(mockToken);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.title).toContain('Token STRATEGY ELIGIBLE');
      expect(sentNotifications[0]?.message).toContain('ELIGIBLE_FOR_STRATEGY');
    });

    it('Trigger 4: notifySimulatedBuy', async () => {
      await service.notifySimulatedBuy(mockTrade);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.title).toContain('[PAPER] BUY FILLED: DOGE2');
      expect(sentNotifications[0]?.message).toContain('SIMULATED PAPER EXECUTION ONLY');
    });

    it('Trigger 5: notifySimulatedSell', async () => {
      await service.notifySimulatedSell({
        ...mockTrade,
        side: 'SELL',
        realizedPnlSol: 0.15,
        realizedPnlPct: 15.0,
        exitReason: 'Target reached',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.title).toContain('[PAPER] SELL FILLED: DOGE2');
      expect(sentNotifications[0]?.message).toContain('+0.1500 SOL');
    });

    it('Trigger 6: notifyStopLossTriggered', async () => {
      await service.notifyStopLossTriggered({
        ...mockTrade,
        side: 'SELL',
        realizedPnlSol: -0.1,
        realizedPnlPct: -10.0,
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.title).toContain('STOP-LOSS TRIGGERED');
      expect(sentNotifications[0]?.priority).toBe('HIGH');
    });

    it('Trigger 7: notifyTakeProfitTriggered', async () => {
      await service.notifyTakeProfitTriggered({
        ...mockTrade,
        side: 'SELL',
        realizedPnlSol: 0.2,
        realizedPnlPct: 20.0,
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.title).toContain('TAKE-PROFIT TRIGGERED');
      expect(sentNotifications[0]?.priority).toBe('HIGH');
    });

    it('Trigger 8: notifyEmergencyExit (trade payload)', async () => {
      await service.notifyEmergencyExit({
        ...mockTrade,
        side: 'SELL',
        exitReason: 'Emergency exit: Sudden liquidity drain',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.priority).toBe('CRITICAL');
      expect(sentNotifications[0]?.title).toContain('EMERGENCY EXIT FILLED');
    });

    it('Trigger 8: notifyEmergencyExit (system payload)', async () => {
      await service.notifyEmergencyExit({
        ...mockSystem,
        type: 'EMERGENCY_EXIT',
        title: 'Emergency Position Liquidation Triggered',
        details: 'Forced liquidation due to risk threshold breach',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.priority).toBe('CRITICAL');
      expect(sentNotifications[0]?.title).toContain('EMERGENCY EXIT CONDITION TRIGGERED');
    });

    it('Trigger 9: notifyDailyLossLimitTriggered', async () => {
      await service.notifyDailyLossLimitTriggered({
        ...mockSystem,
        type: 'DAILY_LOSS_LIMIT',
        title: 'Global Daily Loss Limit Exceeded',
        details: 'Trading halted. Total simulated loss: 5.5 SOL (Limit: 5.0 SOL)',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.priority).toBe('CRITICAL');
      expect(sentNotifications[0]?.title).toContain('DAILY SIMULATED LOSS LIMIT BREACHED');
    });

    it('Trigger 10: notifyProviderOutage', async () => {
      await service.notifyProviderOutage({
        ...mockSystem,
        type: 'PROVIDER_OUTAGE',
        details: 'Helius RPC endpoint unreachable after 3 retries',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.priority).toBe('CRITICAL');
      expect(sentNotifications[0]?.title).toContain('DATA PROVIDER OUTAGE DETECTED');
    });

    it('Trigger 11: notifyStaleMarketData', async () => {
      await service.notifyStaleMarketData({
        ...mockSystem,
        type: 'STALE_MARKET_DATA',
        title: 'Price feed stale for open position',
        details: 'Last price update > 30s ago',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.priority).toBe('HIGH');
      expect(sentNotifications[0]?.title).toContain('STALE CRITICAL MARKET DATA');
    });

    it('Trigger 12: notifyReconciliationError', async () => {
      await service.notifyReconciliationError({
        ...mockSystem,
        type: 'RECONCILIATION_ERROR',
        title: 'Position Ledger Inconsistency',
        details: 'Discrepancy detected between database and in-memory portfolio balance',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentNotifications[0]?.priority).toBe('CRITICAL');
      expect(sentNotifications[0]?.title).toContain('PAPER-TRADING RECONCILIATION ERROR');
    });

    it('tracks recent notification history', async () => {
      await service.notify(
        'SYSTEM_HEALTH',
        'Health Check Passed',
        'All subsystems operational',
        'LOW',
      );
      await new Promise((r) => setTimeout(r, 50));

      const recent = service.getRecent(5);
      expect(recent.length).toBeGreaterThanOrEqual(1);
      expect(recent[0]?.title).toBe('Health Check Passed');
    });
  });
});
