import fs from 'node:fs/promises';
import path from 'node:path';
import type { PersistedSystemState } from './system-state.types.js';
import type { CommandAuditRecord } from '../telegram/telegram.types.js';
import type { Prisma } from '@prisma/client';
import { prismaService } from '../persistence/prisma.service.js';
import { logger } from '../observability/logger.js';

export class SystemStateRepository {
  private stateFilePath: string;
  private auditFilePath: string;
  private initialized = false;

  constructor(customDir?: string) {
    const baseDir = customDir ?? path.resolve(process.cwd(), 'data');
    this.stateFilePath = path.join(baseDir, 'system-state.json');
    this.auditFilePath = path.join(baseDir, 'control-audit.jsonl');
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    try {
      const dir = path.dirname(this.stateFilePath);
      await fs.mkdir(dir, { recursive: true });
      this.initialized = true;
    } catch (err) {
      logger.error({ err }, '[SystemStateRepository] Failed to ensure data directory');
    }
  }

  /**
   * Loads persisted system state from disk and/or database.
   * Requirement 11: Persist operating state across restarts.
   */
  public async loadState(): Promise<PersistedSystemState | null> {
    await this.ensureDir();

    // 1. Try reading from persistent local file
    try {
      const data = await fs.readFile(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(data) as PersistedSystemState;
      if (parsed && parsed.state) {
        logger.info(
          { state: parsed.state, updatedAt: parsed.updatedAt },
          '[SystemStateRepository] Loaded persisted operating state from disk',
        );
        return parsed;
      }
    } catch {
      // File not found or empty on first run - check database or fallback
    }

    // 2. Fallback to PostgreSQL SentinelEventLog if available
    try {
      const prisma = prismaService.getClient();
      const latestLog = await prisma.sentinelEventLog.findFirst({
        where: { category: 'SYSTEM_STATE_TRANSITION' },
        orderBy: { createdAt: 'desc' },
      });

      if (latestLog && latestLog.metadata) {
        const meta = latestLog.metadata as Record<string, unknown>;
        if (meta['toState']) {
          const dbState: PersistedSystemState = {
            state: meta['toState'] as PersistedSystemState['state'],
            updatedAt: latestLog.createdAt.toISOString(),
            updatedBy: (meta['triggeredBy'] as PersistedSystemState['updatedBy']) ?? {
              userId: 0,
              username: 'system',
            },
            reason: latestLog.message,
            customConfig: meta['customConfig'] as PersistedSystemState['customConfig'],
          };
          logger.info(
            { state: dbState.state },
            '[SystemStateRepository] Restored operating state from PostgreSQL event log',
          );
          // Sync to disk
          await this.saveState(dbState);
          return dbState;
        }
      }
    } catch {
      // DB may be offline
    }

    return null;
  }

  /**
   * Atomically persists operating state to disk and logs to PostgreSQL.
   */
  public async saveState(state: PersistedSystemState): Promise<void> {
    await this.ensureDir();

    // 1. Atomic write to local file using temp file
    try {
      const tempFile = `${this.stateFilePath}.${Date.now()}.tmp`;
      const content = JSON.stringify(state, null, 2);
      await fs.writeFile(tempFile, content, 'utf8');
      await fs.rename(tempFile, this.stateFilePath);
      logger.debug(
        { state: state.state, path: this.stateFilePath },
        '[SystemStateRepository] Operating state persisted to disk',
      );
    } catch (err) {
      logger.error({ err }, '[SystemStateRepository] Failed to write system state file');
    }

    // 2. Sync to PostgreSQL event log if available
    try {
      const prisma = prismaService.getClient();
      await prisma.sentinelEventLog.create({
        data: {
          category: 'SYSTEM_STATE_TRANSITION',
          level: 'INFO',
          message: state.reason || `System transitioned to ${state.state}`,
          metadata: {
            toState: state.state,
            updatedBy: state.updatedBy,
            customConfig: state.customConfig,
            metadata: state.metadata,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Ignore if DB offline
    }
  }

  /**
   * Appends an audit record to persistent disk log and PostgreSQL.
   * Requirement 12: Record an audit trail of every control action.
   */
  public async recordAudit(record: CommandAuditRecord): Promise<void> {
    await this.ensureDir();

    // 1. Append to local audit JSONL file
    try {
      const line = JSON.stringify(record) + '\n';
      await fs.appendFile(this.auditFilePath, line, 'utf8');
    } catch (err) {
      logger.warn({ err }, '[SystemStateRepository] Could not append to control-audit.jsonl');
    }

    // 2. Persist to PostgreSQL SentinelEventLog if available
    try {
      const prisma = prismaService.getClient();
      await prisma.sentinelEventLog.create({
        data: {
          category: 'TELEGRAM_CONTROL_AUDIT',
          level: record.status === 'SUCCESS' ? 'INFO' : 'WARN',
          message: `/${record.command} [${record.status}] by ${record.username ?? record.userId}`,
          metadata: {
            auditId: record.id,
            userId: record.userId,
            username: record.username,
            command: record.command,
            args: record.args,
            status: record.status,
            durationMs: record.durationMs,
            error: record.error,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Ignore if DB offline
    }
  }

  /**
   * Reads recent audit records from disk file for operator inspection.
   */
  public async getRecentAuditRecords(limit = 20): Promise<CommandAuditRecord[]> {
    try {
      const content = await fs.readFile(this.auditFilePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const records: CommandAuditRecord[] = [];

      for (let i = lines.length - 1; i >= 0 && records.length < limit; i--) {
        try {
          const rec = JSON.parse(lines[i]!) as CommandAuditRecord;
          rec.timestamp = new Date(rec.timestamp);
          records.push(rec);
        } catch {
          // ignore corrupted line
        }
      }

      return records;
    } catch {
      return [];
    }
  }
}

export const systemStateRepository = new SystemStateRepository();
