import type { Context } from 'grammy';
import { z } from 'zod';

export interface TelegramCommandContext {
  ctx: Context;
  userId: number;
  username?: string;
  args: string[];
  replyHtml: (html: string) => Promise<void>;
}

export type TelegramCommandHandler = (context: TelegramCommandContext) => Promise<void>;

export interface CommandDefinition {
  command: string;
  description: string;
  isSensitive?: boolean;
  handler: TelegramCommandHandler;
}

export type CommandAuditStatus =
  | 'SUCCESS'
  | 'REJECTED_UNAUTHORIZED'
  | 'REJECTED_RATE_LIMIT'
  | 'VALIDATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'DUPLICATE_IGNORED'
  | 'UNKNOWN_COMMAND';

export interface CommandAuditRecord {
  id: string;
  userId: number;
  username?: string;
  command: string;
  args: string[];
  status: CommandAuditStatus;
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// ==========================================
// Zod Validation Schemas for Command Inputs
// ==========================================

export const InspectCommandSchema = z.object({
  tokenAddress: z
    .string({ required_error: 'Token mint address is required' })
    .trim()
    .min(32, 'Solana mint address must be at least 32 characters')
    .max(44, 'Solana mint address must be at most 44 characters')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Token address must be a valid Base58 Solana public key'),
});

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be 1 or greater').default(1),
});

export const TopCommandSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(25, 'Limit cannot exceed 25')
    .default(5),
});

export const HistoryCommandSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be 1 or greater').default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(5),
});

export const SetCommandSchema = z.object({
  param: z
    .string({ required_error: 'Parameter name is required' })
    .trim()
    .min(1, 'Parameter name cannot be empty'),
  value: z
    .string({ required_error: 'Parameter value is required' })
    .trim()
    .min(1, 'Parameter value cannot be empty'),
});

export const ConfirmCommandSchema = z.object({
  token: z
    .string({ required_error: 'Confirmation token is required' })
    .trim()
    .min(6, 'Confirmation token must be at least 6 characters')
    .max(32, 'Confirmation token cannot exceed 32 characters')
    .regex(/^cfg_[a-fA-F0-9]+$/, 'Invalid confirmation token format (expected cfg_xxxx)'),
});
