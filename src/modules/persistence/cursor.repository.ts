import { prismaService } from './prisma.service.js';
import type { DiscoveryCursorRecord } from '../discovery/discovery.types.js';
import { logger } from '../observability/logger.js';

export class CursorRepository {
  public async getCursor(id = 'pump_fun_cursor'): Promise<DiscoveryCursorRecord | null> {
    try {
      const prisma = prismaService.getClient();
      const record = await prisma.discoveryCursor.findUnique({
        where: { id },
      });

      if (!record) return null;

      return {
        id: record.id,
        lastSlot: Number(record.lastSlot),
        lastSignature: record.lastSignature,
        lastProcessedAt: record.lastProcessedAt,
      };
    } catch (err) {
      logger.debug(
        { err, id },
        '[CursorRepository] Could not fetch cursor (database may be offline)',
      );
      return null;
    }
  }

  public async saveCursor(
    slot: number,
    signature: string | null,
    id = 'pump_fun_cursor',
  ): Promise<void> {
    try {
      const prisma = prismaService.getClient();
      await prisma.discoveryCursor.upsert({
        where: { id },
        create: {
          id,
          lastSlot: BigInt(slot),
          lastSignature: signature,
          lastProcessedAt: new Date(),
        },
        update: {
          lastSlot: BigInt(slot),
          lastSignature: signature,
          lastProcessedAt: new Date(),
        },
      });
    } catch (err) {
      logger.debug({ err, slot }, '[CursorRepository] Failed to save cursor to PostgreSQL');
    }
  }
}

export const cursorRepository = new CursorRepository();
