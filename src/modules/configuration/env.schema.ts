import { z } from 'zod';

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    TELEGRAM_AUTHORIZED_USER_IDS: z
      .string()
      .default('')
      .transform((val) =>
        val
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
          .map((id) => {
            const num = Number(id);
            if (Number.isNaN(num)) {
              throw new Error(`Invalid Telegram user ID in TELEGRAM_AUTHORIZED_USER_IDS: "${id}"`);
            }
            return num;
          }),
      ),

    SOLANA_RPC_HTTP_URL: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().url().default('https://api.mainnet-beta.solana.com'),
    ),
    SOLANA_RPC_WS_URL: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().url().default('wss://api.mainnet-beta.solana.com'),
    ),
    HELIUS_API_KEY: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().optional(),
    ),
    HELIUS_RPC_HTTP_URL: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().url().optional(),
    ),
    HELIUS_RPC_WS_URL: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().url().optional(),
    ),
    PUMP_FUN_PROGRAM_ID: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().min(32).default('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
    ),

    RPC_MAX_REQUESTS_PER_SECOND: z.coerce.number().positive().default(10),
    RPC_TIMEOUT_MS: z.coerce.number().positive().default(10000),
    RPC_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
    POLLING_INTERVAL_MS: z.coerce.number().positive().default(5000),
    DEDUPLICATION_CACHE_SIZE: z.coerce.number().int().positive().default(5000),
    DEDUPLICATION_TTL_MS: z.coerce.number().int().positive().default(300000),

    PAPER_INITIAL_SOL_BALANCE: z.coerce.number().positive().default(10.0),
    PAPER_MAX_SLIPPAGE_BPS: z.coerce.number().int().nonnegative().default(150),
    PAPER_SIMULATED_FEE_SOL: z.coerce.number().nonnegative().default(0.005),

    PORTFOLIO_STOP_LOSS_PCT: z.coerce.number().positive().default(10.0),
    PORTFOLIO_TAKE_PROFIT_PCT: z.coerce.number().positive().default(20.0),
    PORTFOLIO_MAX_HOLDING_TIME_MS: z.coerce.number().positive().default(300000),
    PORTFOLIO_MAX_DAILY_LOSS_PCT: z.coerce.number().positive().default(10.0),
    PORTFOLIO_MAX_DRAWDOWN_PCT: z.coerce.number().positive().default(15.0),
    PORTFOLIO_MAX_POSITION_SIZE_SOL: z.coerce.number().positive().default(1.0),
    PORTFOLIO_MAX_CONCURRENT_POSITIONS: z.coerce.number().int().positive().default(5),
    PORTFOLIO_MAX_TOTAL_EXPOSURE_SOL: z.coerce.number().positive().default(4.0),

    RISK_MAX_TOP10_HOLDING_PCT: z.coerce.number().min(0).max(100).default(30.0),
    RISK_MAX_DEV_HOLDING_PCT: z.coerce.number().min(0).max(100).default(10.0),
    RISK_MIN_LIQUIDITY_SOL: z.coerce.number().nonnegative().default(15.0),

    MAX_CACHE_TOKENS: z.coerce.number().int().positive().default(500),

    ANALYSIS_MAX_CONCURRENCY: z.coerce.number().int().positive().default(3),
    ANALYSIS_RPC_BUDGET_PER_TOKEN: z.coerce.number().int().positive().default(8),

    NOTIF_QUIET_HOURS_ENABLED: z.coerce.boolean().default(false),
    NOTIF_QUIET_HOURS_START_UTC: z.coerce.number().int().min(0).max(23).default(22),
    NOTIF_QUIET_HOURS_END_UTC: z.coerce.number().int().min(0).max(23).default(7),
    NOTIF_BATCH_INTERVAL_MS: z.coerce.number().positive().default(30000),
    NOTIF_BATCH_MAX_ITEMS: z.coerce.number().positive().default(5),
  })
  .superRefine((_data, ctx) => {
    // Explicit safety invariant: Guard against accidental real wallet / private key injection
    const forbiddenKeys = [
      'PRIVATE_KEY',
      'SOLANA_PRIVATE_KEY',
      'WALLET_PRIVATE_KEY',
      'MNEMONIC',
      'SEED_PHRASE',
    ];
    for (const key of forbiddenKeys) {
      if (process.env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `CRITICAL SAFETY VIOLATION: ${key} detected in environment. PumpSentinel strictly enforces simulated paper-trading only. Wallet private keys are forbidden!`,
          path: [key],
        });
      }
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;
