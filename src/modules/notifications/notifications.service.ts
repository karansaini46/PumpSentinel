import crypto from 'node:crypto';
import type {
  SentinelNotification,
  INotificationChannel,
  NotificationPriority,
} from './notifications.types.js';
import { logger } from '../observability/logger.js';

export class NotificationsService {
  private channels: INotificationChannel[] = [];
  private recentNotifications: SentinelNotification[] = [];
  private readonly maxHistorySize: number;

  constructor(maxHistorySize = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  public registerChannel(channel: INotificationChannel): void {
    this.channels.push(channel);
  }

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
    };

    // Keep bounded history in memory
    this.recentNotifications.unshift(notification);
    if (this.recentNotifications.length > this.maxHistorySize) {
      this.recentNotifications.pop();
    }

    logger.info(
      { id: notification.id, category, priority, title },
      '[NotificationsService] Dispatching notification',
    );

    // Broadcast across channels asynchronously
    for (const channel of this.channels) {
      channel.send(notification).catch((err) => {
        logger.error({ err, channel }, '[NotificationsService] Failed to send notification');
      });
    }

    return notification;
  }

  public getRecent(limit = 10): SentinelNotification[] {
    return this.recentNotifications.slice(0, limit);
  }
}

export const notificationsService = new NotificationsService();
