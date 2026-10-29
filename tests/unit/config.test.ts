import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvSchema } from '../../src/modules/configuration/env.schema.js';
import { ConfigService } from '../../src/modules/configuration/config.service.js';

describe('Configuration Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('validates minimal valid environment and supplies defaults', () => {
    const rawEnv = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    };

    const parsed = EnvSchema.parse(rawEnv);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.PAPER_INITIAL_SOL_BALANCE).toBe(10.0);
    expect(parsed.PAPER_MAX_SLIPPAGE_BPS).toBe(150);
    expect(parsed.MAX_CACHE_TOKENS).toBe(500);
  });

  it('correctly parses comma-separated authorized Telegram user IDs', () => {
    const service = new ConfigService({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      TELEGRAM_BOT_TOKEN: 'mock_token',
      TELEGRAM_AUTHORIZED_USER_IDS: '111, 222, 333',
    });

    expect(service.isAuthorizedUser(111)).toBe(true);
    expect(service.isAuthorizedUser(222)).toBe(true);
    expect(service.isAuthorizedUser(999)).toBe(false);
  });

  it('STRICT INVARIANT: rejects environment containing private keys or wallet keys', () => {
    process.env['PRIVATE_KEY'] = '5Mii...fake_private_key';

    expect(() => {
      new ConfigService({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        TELEGRAM_BOT_TOKEN: 'mock_token',
      });
    }).toThrow(/CRITICAL SAFETY VIOLATION/);

    delete process.env['PRIVATE_KEY'];
  });
});
