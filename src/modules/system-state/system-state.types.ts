import { z } from 'zod';
import type { PortfolioRiskConfig } from '../risk/portfolio-risk.types.js';
import type { StrategyConfig } from '../strategy/strategy.types.js';

export type SystemOperatingState = 'STOPPED' | 'MONITORING' | 'PAUSED' | 'ERROR';

export interface StateTransitionDetails {
  fromState: SystemOperatingState;
  toState: SystemOperatingState;
  reason: string;
  triggeredBy: {
    userId: number;
    username?: string;
  };
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface StateTransitionResult {
  success: boolean;
  fromState: SystemOperatingState;
  toState: SystemOperatingState;
  message: string;
  duplicate?: boolean;
  error?: string;
  transition?: StateTransitionDetails;
}

export interface HealthPrecheckResult {
  healthy: boolean;
  dataSourceStatus: 'ok' | 'degraded' | 'down';
  dataSourceDetails: string;
  riskConfigValid: boolean;
  riskConfigDetails: string;
}

export interface PendingConfigChange {
  token: string;
  userId: number;
  username?: string;
  parameter: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface PersistedSystemState {
  state: SystemOperatingState;
  updatedAt: string;
  updatedBy: {
    userId: number;
    username?: string;
  };
  reason: string;
  metadata?: Record<string, unknown>;
  customConfig?: {
    risk?: Partial<PortfolioRiskConfig>;
    strategy?: Partial<StrategyConfig>;
  };
}

// =========================================================================
// Zod Validation Schemas for Configurable Parameters (Requirement 8)
// =========================================================================

export const ConfigParameterSchema = z.enum([
  'stop_loss',
  'take_profit',
  'max_holding_time_sec',
  'max_daily_loss',
  'max_drawdown',
  'max_position_size',
  'max_concurrent_positions',
  'max_total_exposure_pct',
  'auto_trade',
  'fixed_buy_amount',
]);

export type ConfigParameterName = z.infer<typeof ConfigParameterSchema>;

export const ConfigValueValidators: Record<ConfigParameterName, z.ZodTypeAny> = {
  stop_loss: z.coerce
    .number()
    .min(1.0, 'Stop-loss must be at least 1%')
    .max(50.0, 'Stop-loss cannot exceed 50%'),
  take_profit: z.coerce
    .number()
    .min(5.0, 'Take-profit must be at least 5%')
    .max(500.0, 'Take-profit cannot exceed 500%'),
  max_holding_time_sec: z.coerce
    .number()
    .int()
    .min(10, 'Holding time must be at least 10 seconds')
    .max(86400, 'Holding time cannot exceed 86,400 seconds (24 hours)'),
  max_daily_loss: z.coerce
    .number()
    .min(1.0, 'Daily loss limit must be at least 1%')
    .max(50.0, 'Daily loss limit cannot exceed 50%'),
  max_drawdown: z.coerce
    .number()
    .min(1.0, 'Max drawdown must be at least 1%')
    .max(50.0, 'Max drawdown cannot exceed 50%'),
  max_position_size: z.coerce
    .number()
    .min(0.01, 'Position size must be at least 0.01 SOL')
    .max(100.0, 'Position size cannot exceed 100 SOL'),
  max_concurrent_positions: z.coerce
    .number()
    .int()
    .min(1, 'Must allow at least 1 concurrent position')
    .max(50, 'Cannot exceed 50 concurrent positions'),
  max_total_exposure_pct: z.coerce
    .number()
    .min(5.0, 'Total exposure must be at least 5%')
    .max(100.0, 'Total exposure cannot exceed 100%'),
  auto_trade: z
    .string()
    .trim()
    .toLowerCase()
    .transform((val) => val === 'true' || val === 'on' || val === '1' || val === 'yes'),
  fixed_buy_amount: z.coerce
    .number()
    .min(0.01, 'Fixed buy amount must be at least 0.01 SOL')
    .max(10.0, 'Fixed buy amount cannot exceed 10 SOL'),
};

export const SetCommandSchema = z.object({
  param: ConfigParameterSchema,
  value: z.string().min(1, 'Value is required'),
});

export const ConfirmCommandSchema = z.object({
  token: z
    .string()
    .trim()
    .min(6, 'Confirmation token must be at least 6 characters')
    .max(32, 'Confirmation token cannot exceed 32 characters')
    .regex(/^cfg_[a-fA-F0-9]+$/, 'Invalid confirmation token format'),
});
