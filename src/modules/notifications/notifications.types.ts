export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SentinelNotification {
  id: string;
  category: 'TOKEN_DISCOVERY' | 'RISK_ALERT' | 'TRADE_SIMULATION' | 'SYSTEM_HEALTH';
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface INotificationChannel {
  send(notification: SentinelNotification): Promise<void>;
}
