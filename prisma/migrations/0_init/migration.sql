-- CreateTable
CREATE TABLE "Token" (
    "mintAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "uri" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 6,
    "creator" TEXT NOT NULL,
    "marketCapSol" DOUBLE PRECISION,
    "priceSol" DOUBLE PRECISION,
    "liquiditySol" DOUBLE PRECISION,
    "bondingCurveProgress" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "lifecycleState" TEXT NOT NULL DEFAULT 'DISCOVERED_ON_CHAIN',
    "metadataStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "signature" TEXT,
    "slot" BIGINT,
    "bondingCurveAddress" TEXT,
    "source" TEXT NOT NULL DEFAULT 'onchain',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "discoveryLatencyMs" DOUBLE PRECISION,
    "onChainTimestamp" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("mintAddress")
);

-- CreateTable
CREATE TABLE "RiskAnalysis" (
    "id" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "top10HoldingPct" DOUBLE PRECISION NOT NULL,
    "devHoldingPct" DOUBLE PRECISION NOT NULL,
    "liquiditySol" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[],
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperPosition" (
    "id" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "amountTokens" DOUBLE PRECISION NOT NULL,
    "entryPriceSol" DOUBLE PRECISION NOT NULL,
    "currentPriceSol" DOUBLE PRECISION NOT NULL,
    "solInvested" DOUBLE PRECISION NOT NULL,
    "realizedPnlSol" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "unrealizedPnlSol" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "positionId" TEXT,
    "tokenMint" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "amountTokens" DOUBLE PRECISION NOT NULL,
    "priceSol" DOUBLE PRECISION NOT NULL,
    "totalSol" DOUBLE PRECISION NOT NULL,
    "simulatedFeeSol" DOUBLE PRECISION NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioAccount" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "simulatedSolBalance" DOUBLE PRECISION NOT NULL,
    "initialSolBalance" DOUBLE PRECISION NOT NULL,
    "totalRealizedPnlSol" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "winCount" INTEGER NOT NULL DEFAULT 0,
    "lossCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentinelEventLog" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentinelEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryCursor" (
    "id" TEXT NOT NULL DEFAULT 'pump_fun_cursor',
    "lastSlot" BIGINT NOT NULL DEFAULT 0,
    "lastSignature" TEXT,
    "lastProcessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Token_status_idx" ON "Token"("status");

-- CreateIndex
CREATE INDEX "Token_discoveredAt_idx" ON "Token"("discoveredAt");

-- CreateIndex
CREATE INDEX "RiskAnalysis_tokenMint_idx" ON "RiskAnalysis"("tokenMint");

-- CreateIndex
CREATE INDEX "RiskAnalysis_passed_idx" ON "RiskAnalysis"("passed");

-- CreateIndex
CREATE INDEX "PaperPosition_tokenMint_idx" ON "PaperPosition"("tokenMint");

-- CreateIndex
CREATE INDEX "PaperPosition_status_idx" ON "PaperPosition"("status");

-- CreateIndex
CREATE INDEX "PaperTrade_tokenMint_idx" ON "PaperTrade"("tokenMint");

-- CreateIndex
CREATE INDEX "PaperTrade_side_idx" ON "PaperTrade"("side");

-- CreateIndex
CREATE INDEX "PaperTrade_executedAt_idx" ON "PaperTrade"("executedAt");

-- CreateIndex
CREATE INDEX "SentinelEventLog_category_idx" ON "SentinelEventLog"("category");

-- CreateIndex
CREATE INDEX "SentinelEventLog_level_idx" ON "SentinelEventLog"("level");

-- CreateIndex
CREATE INDEX "SentinelEventLog_createdAt_idx" ON "SentinelEventLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RiskAnalysis" ADD CONSTRAINT "RiskAnalysis_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mintAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperPosition" ADD CONSTRAINT "PaperPosition_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mintAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "PaperPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mintAddress") ON DELETE CASCADE ON UPDATE CASCADE;

