import crypto from 'node:crypto';
import type {
  SentinelNotification,
  INotificationChannel,
  NotificationPriority,
  NotificationCategory,
  TokenAlertPayload,
  SimulatedTradeAlertPayload,
  SystemAlertPayload,
} from './notifications.types.js';
import { formatTokenAlert, formatTradeAlert, formatSystemAlert } from './notification-formatter.js';
import { notificationQueue, NotificationQueue } from './notification-queue.js';
import { configService } from '../configuration/config.service.js';
import { logger } from '../observability/logger.js';

export class NotificationsService {
  private channels: INotificationChannel[] = [];
  private recentNotifications: SentinelNotification[] = [];
  private readonly maxHistorySize: number;
  private queue: NotificationQueue;

  constructor(maxHistorySize = 100, customQueue?: NotificationQueue) {
    this.maxHistorySize = maxHistorySize;
    this.queue = customQueue ?? notificationQueue;

    // Apply configuration from configService if available
    try {
      const config = configService.getAll();
      this.queue.updateConfig({
        batchIntervalMs: config.NOTIF_BATCH_INTERVAL_MS,
        batchMaxItems: config.NOTIF_BATCH_MAX_ITEMS,
        quietHours: {
          enabled: config.NOTIF_QUIET_HOURS_ENABLED,
          startHourUtc: config.NOTIF_QUIET_HOURS_START_UTC,
          endHourUtc: config.NOTIF_QUIET_HOURS_END_UTC,
          allowCritical: true,
          allowHigh: true,
        },
      });
    } catch {
      // Ignore during isolated unit tests without config
    }

    // Connect queue dispatcher to registered channels
    this.queue.setHandler(async (notification: SentinelNotification) => {
      this.recordRecent(notification);
      for (const channel of this.channels) {
        try {
          await channel.send(notification);
        } catch (err) {
          logger.error(
            { err, channel: channel.constructor.name, title: notification.title },
            '[NotificationsService] Channel send failed',
          );
          throw err; // Allow queue retry mechanism to trigger
        }
      }
    });

    this.queue.start();
  }

  public registerChannel(channel: INotificationChannel): void {
    this.channels.push(channel);
  }

  public getQueue(): NotificationQueue {
    return this.queue;
  }

  // =========================================================================
  // 1. Newly Discovered Tokens
  // =========================================================================
  public async notifyTokenDiscovered(
    payload: TokenAlertPayload,
    options: { batch?: boolean } = { batch: true },
  ): Promise<boolean> {
    if (options.batch !== false) {
      // Requirement 6: Batch low-priority alerts
      this.queue.enqueueBatchToken(payload);
      return true;
    }

    const formatted = formatTokenAlert(payload);
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      formatted.priority,
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 2. Risk Rejection
  // =========================================================================
  public async notifyRiskRejected(payload: TokenAlertPayload): Promise<boolean> {
    const formatted = formatTokenAlert({
      ...payload,
      decision: 'REJECT',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      formatted.priority,
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 3. Tokens Eligible for Strategy Evaluation
  // =========================================================================
  public async notifyStrategyEligible(payload: TokenAlertPayload): Promise<boolean> {
    const formatted = formatTokenAlert({
      ...payload,
      decision: 'ELIGIBLE_FOR_STRATEGY',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      formatted.priority,
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 4. Simulated Buy
  // =========================================================================
  public async notifySimulatedBuy(payload: SimulatedTradeAlertPayload): Promise<boolean> {
    const formatted = formatTradeAlert({
      ...payload,
      side: 'BUY',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      formatted.priority,
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 5. Simulated Sell
  // =========================================================================
  public async notifySimulatedSell(payload: SimulatedTradeAlertPayload): Promise<boolean> {
    const formatted = formatTradeAlert({
      ...payload,
      side: 'SELL',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      formatted.priority,
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 6. Stop-Loss Trigger
  // =========================================================================
  public async notifyStopLossTriggered(payload: SimulatedTradeAlertPayload): Promise<boolean> {
    const formatted = formatTradeAlert({
      ...payload,
      side: 'SELL',
      exitReason: payload.exitReason ?? 'Stop-loss triggered',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      'HIGH',
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 7. Take-Profit Trigger
  // =========================================================================
  public async notifyTakeProfitTriggered(payload: SimulatedTradeAlertPayload): Promise<boolean> {
    const formatted = formatTradeAlert({
      ...payload,
      side: 'SELL',
      exitReason: payload.exitReason ?? 'Take-profit target hit',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      'HIGH',
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 8. Emergency Exit
  // =========================================================================
  public async notifyEmergencyExit(
    payload: SimulatedTradeAlertPayload | SystemAlertPayload,
  ): Promise<boolean> {
    if ('side' in payload) {
      const formatted = formatTradeAlert({
        ...payload,
        exitReason: payload.exitReason ?? 'Emergency exit condition triggered',
      });
      return await this.enqueueFormatted(
        `🚨 [CRITICAL] [PAPER] EMERGENCY EXIT FILLED: ${payload.tokenSymbol}`,
        formatted.html,
        'TRADE_SIMULATION',
        'CRITICAL', // Immediate critical alert!
        formatted.dedupeKey,
        { payload },
      );
    } else {
      const formatted = formatSystemAlert({
        ...payload,
        type: 'EMERGENCY_EXIT',
      });
      return await this.enqueueFormatted(
        formatted.title,
        formatted.html,
        formatted.category,
        'CRITICAL',
        formatted.dedupeKey,
        { payload },
      );
    }
  }

  // =========================================================================
  // 9. Daily Loss-Limit Trigger
  // =========================================================================
  public async notifyDailyLossLimitTriggered(payload: SystemAlertPayload): Promise<boolean> {
    const formatted = formatSystemAlert({
      ...payload,
      type: 'DAILY_LOSS_LIMIT',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      'CRITICAL',
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 10. Provider Outage
  // =========================================================================
  public async notifyProviderOutage(payload: SystemAlertPayload): Promise<boolean> {
    const formatted = formatSystemAlert({
      ...payload,
      type: 'PROVIDER_OUTAGE',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      'CRITICAL',
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 11. Stale Critical Market Data
  // =========================================================================
  public async notifyStaleMarketData(payload: SystemAlertPayload): Promise<boolean> {
    const formatted = formatSystemAlert({
      ...payload,
      type: 'STALE_MARKET_DATA',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      'HIGH',
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // 12. Paper-Trading Reconciliation Errors
  // =========================================================================
  public async notifyReconciliationError(payload: SystemAlertPayload): Promise<boolean> {
    const formatted = formatSystemAlert({
      ...payload,
      type: 'RECONCILIATION_ERROR',
    });
    return await this.enqueueFormatted(
      formatted.title,
      formatted.html,
      formatted.category,
      'CRITICAL',
      formatted.dedupeKey,
      { payload },
    );
  }

  // =========================================================================
  // General notify() for Backward Compatibility & Extensibility
  // =========================================================================
  public async notify(
    category: SentinelNotification['category'],
    title: string,
    message: string,
    priority: NotificationPriority = 'MEDIUM',
    metadata?: Record<string, unknown>,
  ): Promise<SentinelNotification> {
    const notification: SentinelNotification = {
      id: `notif_${crypto.randomUUID()}`,
      category,
      priority,
      title,
      message,
      timestamp: new Date(),
      metadata,
      dedupeKey: `notif:${category}:${title}`,
    };

    void this.queue.enqueue(notification);
    return notification;
  }

  private async enqueueFormatted(
    title: string,
    message: string,
    category: NotificationCategory,
    priority: NotificationPriority,
    dedupeKey: string,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const notification: SentinelNotification = {
      id: `notif_${crypto.randomUUID()}`,
      category,
      priority,
      title,
      message,
      timestamp: new Date(),
      dedupeKey,
      metadata,
    };

    return await this.queue.enqueue(notification);
  }

  private recordRecent(notification: SentinelNotification): void {
    this.recentNotifications.unshift(notification);
    if (this.recentNotifications.length > this.maxHistorySize) {
      this.recentNotifications.pop();
    }
  }

  public getRecent(limit = 10): SentinelNotification[] {
    return this.recentNotifications.slice(0, limit);
  }
}

export const notificationsService = new NotificationsService();
