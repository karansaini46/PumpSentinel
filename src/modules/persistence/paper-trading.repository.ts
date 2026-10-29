import { prismaService } from './prisma.service.js';
import type { PaperPosition, PaperTrade, PortfolioAccount } from './persistence.types.js';
import { logger } from '../observability/logger.js';

export interface CreatePaperPositionInput {
  id?: string;
  tokenMint: string;
  tokenSymbol: string;
  amountTokens: number;
  entryPriceSol: number;
  currentPriceSol: number;
  solInvested: number;
  status?: string;
  openedAt?: Date;
}

export interface CreatePaperTradeInputWithId {
  id?: string;
  positionId?: string;
  tokenMint: string;
  side: 'BUY' | 'SELL';
  amountTokens: number;
  priceSol: number;
  totalSol: number;
  simulatedFeeSol: number;
  slippageBps: number;
  reason: string;
  executedAt?: Date;
}

export class PaperTradingRepository {
  // In-memory fallback and query cache (used in testing and when offline)
  private memoryPositions = new Map<string, PaperPosition>();
  private memoryTrades = new Map<string, PaperTrade>();
  private memoryAccount: PortfolioAccount | null = null;

  public async savePosition(input: CreatePaperPositionInput): Promise<PaperPosition> {
    const id = input.id ?? `pos_${crypto.randomUUID()}`;
    const openedAt = input.openedAt ?? new Date();

    const positionRecord: PaperPosition = {
      id,
      tokenMint: input.tokenMint,
      tokenSymbol: input.tokenSymbol,
      status: input.status ?? 'OPEN',
      amountTokens: input.amountTokens,
      entryPriceSol: input.entryPriceSol,
      currentPriceSol: input.currentPriceSol,
      solInvested: input.solInvested,
      realizedPnlSol: 0.0,
      unrealizedPnlSol: 0.0,
      openedAt,
      closedAt: null,
      updatedAt: new Date(),
    };

    this.memoryPositions.set(input.tokenMint, positionRecord);

    if (prismaService.connected) {
      try {
        const prisma = prismaService.getClient();
        return await prisma.paperPosition.upsert({
          where: { id },
          create: positionRecord,
          update: {
            amountTokens: input.amountTokens,
            entryPriceSol: input.entryPriceSol,
            currentPriceSol: input.currentPriceSol,
            solInvested: input.solInvested,
            status: input.status ?? 'OPEN',
          },
        });
      } catch (err) {
        logger.warn(
          { err, mint: input.tokenMint },
          '[PaperTradingRepository] Prisma savePosition failed, relying on memory cache',
        );
      }
    }

    return positionRecord;
  }

  public async updatePositionStatus(
    tokenMint: string,
    status: 'OPEN' | 'CLOSED' | 'EMERGENCY_CLOSED',
    realizedPnlSol?: number,
    closedAt?: Date,
  ): Promise<PaperPosition | null> {
    const mem = this.memoryPositions.get(tokenMint);
    if (mem) {
      mem.status = status;
      if (typeof realizedPnlSol === 'number') mem.realizedPnlSol = realizedPnlSol;
      if (closedAt) mem.closedAt = closedAt;
      mem.updatedAt = new Date();
    }

    if (prismaService.connected && mem) {
      try {
        const prisma = prismaService.getClient();
        return await prisma.paperPosition.update({
          where: { id: mem.id },
          data: {
            status,
            realizedPnlSol: realizedPnlSol ?? mem.realizedPnlSol,
            closedAt: closedAt ?? (status !== 'OPEN' ? new Date() : null),
          },
        });
      } catch (err) {
        logger.warn(
          { err, mint: tokenMint },
          '[PaperTradingRepository] Prisma updatePositionStatus failed',
        );
      }
    }

    return mem ?? null;
  }

  public async recordTrade(input: CreatePaperTradeInputWithId): Promise<PaperTrade> {
    const id = input.id ?? `trade_${crypto.randomUUID()}`;
    const executedAt = input.executedAt ?? new Date();

    const tradeRecord: PaperTrade = {
      id,
      positionId: input.positionId ?? null,
      tokenMint: input.tokenMint,
      side: input.side,
      amountTokens: input.amountTokens,
      priceSol: input.priceSol,
      totalSol: input.totalSol,
      simulatedFeeSol: input.simulatedFeeSol,
      slippageBps: input.slippageBps,
      reason: input.reason,
      executedAt,
    };

    this.memoryTrades.set(id, tradeRecord);

    if (prismaService.connected) {
      try {
        const prisma = prismaService.getClient();
        return await prisma.paperTrade.create({
          data: tradeRecord,
        });
      } catch (err) {
        logger.warn(
          { err, tradeId: id },
          '[PaperTradingRepository] Prisma recordTrade failed, relying on memory cache',
        );
      }
    }

    return tradeRecord;
  }

  public async saveAccount(account: {
    simulatedSolBalance: number;
    initialSolBalance: number;
    totalRealizedPnlSol: number;
    winCount: number;
    lossCount: number;
  }): Promise<PortfolioAccount> {
    const record: PortfolioAccount = {
      id: 'default',
      simulatedSolBalance: account.simulatedSolBalance,
      initialSolBalance: account.initialSolBalance,
      totalRealizedPnlSol: account.totalRealizedPnlSol,
      winCount: account.winCount,
      lossCount: account.lossCount,
      updatedAt: new Date(),
    };

    this.memoryAccount = record;

    if (prismaService.connected) {
      try {
        const prisma = prismaService.getClient();
        return await prisma.portfolioAccount.upsert({
          where: { id: 'default' },
          create: record,
          update: {
            simulatedSolBalance: account.simulatedSolBalance,
            totalRealizedPnlSol: account.totalRealizedPnlSol,
            winCount: account.winCount,
            lossCount: account.lossCount,
          },
        });
      } catch (err) {
        logger.warn({ err }, '[PaperTradingRepository] Prisma saveAccount failed');
      }
    }

    return record;
  }

  public async loadAccount(): Promise<PortfolioAccount | null> {
    if (prismaService.connected) {
      try {
        const prisma = prismaService.getClient();
        const acc = await prisma.portfolioAccount.findUnique({ where: { id: 'default' } });
        if (acc) return acc;
      } catch (err) {
        logger.warn({ err }, '[PaperTradingRepository] Prisma loadAccount failed');
      }
    }
    return this.memoryAccount;
  }

  public async getAllPositions(): Promise<PaperPosition[]> {
    if (prismaService.connected) {
      try {
        const prisma = prismaService.getClient();
        return await prisma.paperPosition.findMany({ orderBy: { openedAt: 'asc' } });
      } catch (err) {
        logger.warn({ err }, '[PaperTradingRepository] Prisma getAllPositions failed');
      }
    }
    return Array.from(this.memoryPositions.values());
  }

  public async getAllTrades(): Promise<PaperTrade[]> {
    if (prismaService.connected) {
      try {
        const prisma = prismaService.getClient();
        return await prisma.paperTrade.findMany({ orderBy: { executedAt: 'asc' } });
      } catch (err) {
        logger.warn({ err }, '[PaperTradingRepository] Prisma getAllTrades failed');
      }
    }
    return Array.from(this.memoryTrades.values());
  }

  public clearMemory(): void {
    this.memoryPositions.clear();
    this.memoryTrades.clear();
    this.memoryAccount = null;
  }
}

export const paperTradingRepository = new PaperTradingRepository();
