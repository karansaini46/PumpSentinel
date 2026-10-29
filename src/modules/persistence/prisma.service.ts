import { PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';

export class PrismaService {
  private client: PrismaClient | null = null;
  private isConnected = false;

  public getClient(): PrismaClient {
    if (!this.client) {
      this.client = new PrismaClient({
        log: [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
      });

      // @ts-expect-error Prisma event typing
      this.client.$on('error', (e: unknown) => {
        logger.error({ e }, '[Prisma] Database error');
      });

      // @ts-expect-error Prisma event typing
      this.client.$on('warn', (e: unknown) => {
        logger.warn({ e }, '[Prisma] Database warning');
      });
    }

    return this.client;
  }

  public async connect(): Promise<void> {
    try {
      const client = this.getClient();
      await client.$connect();
      this.isConnected = true;
      logger.info('[PrismaService] Connected to PostgreSQL');
    } catch (err) {
      this.isConnected = false;
      logger.error({ err }, '[PrismaService] Failed to connect to PostgreSQL');
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.$disconnect();
      this.isConnected = false;
      logger.info('[PrismaService] Disconnected from PostgreSQL');
    }
  }

  public async ping(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.$queryRaw`SELECT 1`;
      this.isConnected = true;
      return true;
    } catch (err) {
      this.isConnected = false;
      logger.warn({ err }, '[PrismaService] PostgreSQL ping failed');
      return false;
    }
  }

  public get connected(): boolean {
    return this.isConnected;
  }
}

export const prismaService = new PrismaService();
