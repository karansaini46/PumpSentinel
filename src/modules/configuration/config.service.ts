import dotenv from 'dotenv';
import { EnvSchema, type AppConfig } from './env.schema.js';

// Load environment variables from .env file if available
dotenv.config();

export class ConfigService {
  private config: AppConfig;

  constructor(envOverride?: Record<string, string | undefined>) {
    this.config = this.validate(envOverride ?? process.env);
  }

  private validate(env: Record<string, string | undefined>): AppConfig {
    const result = EnvSchema.safeParse(env);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => ` - [${issue.path.join('.') || 'root'}]: ${issue.message}`)
        .join('\n');
      throw new Error(`[Configuration] Invalid environment variables:\n${issues}`);
    }
    return result.data;
  }

  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  public getAll(): Readonly<AppConfig> {
    return Object.freeze({ ...this.config });
  }

  public isAuthorizedUser(userId: number): boolean {
    const list = this.config.TELEGRAM_AUTHORIZED_USER_IDS;
    return list.length === 0 || list.includes(userId);
  }
}

export const configService = new ConfigService();
