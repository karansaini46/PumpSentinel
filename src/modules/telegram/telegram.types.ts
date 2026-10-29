import type { Context } from 'grammy';

export interface TelegramCommandContext {
  ctx: Context;
  userId: number;
  args: string[];
}

export type TelegramCommandHandler = (context: TelegramCommandContext) => Promise<void>;

export interface CommandDefinition {
  command: string;
  description: string;
  handler: TelegramCommandHandler;
}
