import { prismaService } from './prisma.service.js';
import type { CreateTokenInput, Token } from './persistence.types.js';

export class TokenRepository {
  public async upsertToken(input: CreateTokenInput): Promise<Token> {
    const prisma = prismaService.getClient();
    return prisma.token.upsert({
      where: { mintAddress: input.mintAddress },
      create: {
        mintAddress: input.mintAddress,
        name: input.name,
        symbol: input.symbol,
        uri: input.uri,
        decimals: input.decimals ?? 6,
        creator: input.creator,
        marketCapSol: input.marketCapSol,
        priceSol: input.priceSol,
        liquiditySol: input.liquiditySol,
        bondingCurveProgress: input.bondingCurveProgress,
        status: input.status ?? 'DISCOVERED',
        lifecycleState: input.lifecycleState ?? 'DISCOVERED_ON_CHAIN',
        metadataStatus: input.metadataStatus ?? 'PENDING',
        signature: input.signature,
        slot: input.slot ? BigInt(input.slot) : undefined,
        bondingCurveAddress: input.bondingCurveAddress,
        source: input.source ?? 'onchain',
        isSynthetic: input.isSynthetic ?? false,
        discoveryLatencyMs: input.discoveryLatencyMs,
        onChainTimestamp: input.onChainTimestamp,
      },
      update: {
        name: input.name,
        symbol: input.symbol,
        uri: input.uri,
        marketCapSol: input.marketCapSol,
        priceSol: input.priceSol,
        liquiditySol: input.liquiditySol,
        bondingCurveProgress: input.bondingCurveProgress,
        lifecycleState: input.lifecycleState,
        metadataStatus: input.metadataStatus,
      },
    });
  }

  public async updateLifecycle(
    mintAddress: string,
    lifecycleState: string,
    metadataStatus?: string,
  ): Promise<Token> {
    const prisma = prismaService.getClient();
    return prisma.token.update({
      where: { mintAddress },
      data: {
        lifecycleState,
        ...(metadataStatus ? { metadataStatus } : {}),
      },
    });
  }

  public async findByMint(mintAddress: string): Promise<Token | null> {
    const prisma = prismaService.getClient();
    return prisma.token.findUnique({
      where: { mintAddress },
      include: {
        riskAnalyses: { orderBy: { analyzedAt: 'desc' }, take: 1 },
      },
    });
  }

  public async getRecentDiscovered(limit = 10): Promise<Token[]> {
    const prisma = prismaService.getClient();
    return prisma.token.findMany({
      orderBy: { discoveredAt: 'desc' },
      take: limit,
    });
  }

  public async findRecentByLifecycle(lifecycleState: string, limit = 10): Promise<Token[]> {
    const prisma = prismaService.getClient();
    return prisma.token.findMany({
      where: { lifecycleState },
      orderBy: { discoveredAt: 'desc' },
      take: limit,
    });
  }
}

export const tokenRepository = new TokenRepository();
