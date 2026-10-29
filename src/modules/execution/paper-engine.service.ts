import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  SimulatedOrderRequest,
  SimulatedExecutionResult,
  PaperExecutionConfig,
} from './execution.types.js';
import { logger } from '../observability/logger.js';
import { riskDecisionGate } from '../risk/risk-decision-gate.js';
import { RiskGateInvariantViolationError } from '../risk/risk.types.js';

export class PaperExecutionEngine {
  private emitter = new EventEmitter();
  private config: PaperExecutionConfig;

  constructor(config?: Partial<PaperExecutionConfig>) {
    // Assert zero possibility of private key / live signing
    this.assertSimulationInvariants();

    this.config = {
      defaultSlippageBps: config?.defaultSlippageBps ?? 150, // 1.5% default
      simulatedFeeSol: config?.simulatedFeeSol ?? 0.005,
    };
  }

  private assertSimulationInvariants(): void {
    const forbidden = [
      process.env['PRIVATE_KEY'],
      process.env['WALLET_KEY'],
      process.env['SOLANA_PRIVATE_KEY'],
      process.env['MNEMONIC'],
    ];

    if (forbidden.some((val) => typeof val === 'string' && val.length > 0)) {
      throw new Error(
        'FATAL: Real private key detected in environment! PumpSentinel only supports simulated trading.',
      );
    }
  }

  public onTradeExecuted(handler: (trade: SimulatedExecutionResult) => void): () => void {
    this.emitter.on('trade', handler);
    return () => {
      this.emitter.off('trade', handler);
    };
  }

  /**
   * Execute a simulated trade strictly in paper-trading mode.
   * FINAL INVARIANT: No token can be purchased by the paper-trading engine unless
   * it has passed the required risk gate and the entry strategy.
   */
  public executeSimulatedOrder(request: SimulatedOrderRequest): SimulatedExecutionResult {
    this.assertSimulationInvariants();

    const slippageBps = request.maxSlippageBps ?? this.config.defaultSlippageBps;
    const slippageMultiplier = slippageBps / 10000;

    let executedPriceSol: number;
    let amountTokens: number;
    let totalSol: number;

    if (request.side === 'BUY') {
      if (!request.solAmount || request.solAmount <= 0) {
        throw new Error('solAmount must be positive for BUY orders');
      }

      // FINAL INVARIANT ENFORCEMENT
      if (!request.bypassRiskGateForTestingOnly) {
        // 1. Verify Risk Gate Eligibility
        riskDecisionGate.assertEligibleForPurchase(request.tokenMint, request.riskDecision);

        // 2. Verify Entry Strategy Clearance
        if (!request.strategySignal || request.strategySignal.action !== 'BUY') {
          throw new RiskGateInvariantViolationError(
            `Invariant violation: Cannot execute paper BUY for token ${request.tokenMint}. Order must be approved by entry strategy with action 'BUY' (received: ${request.strategySignal?.action ?? 'NONE'}).`,
            {
              mint: request.tokenMint,
              strategySignal: request.strategySignal,
            },
          );
        }
      }

      // Buying with slippage: price moves up
      executedPriceSol = request.currentPriceSol * (1 + slippageMultiplier);
      totalSol = request.solAmount;
      amountTokens = totalSol / executedPriceSol;
    } else {
      if (!request.tokenAmount || request.tokenAmount <= 0) {
        throw new Error('tokenAmount must be positive for SELL orders');
      }
      // Selling with slippage: price moves down
      executedPriceSol = request.currentPriceSol * (1 - slippageMultiplier);
      amountTokens = request.tokenAmount;
      totalSol = amountTokens * executedPriceSol;
    }

    const tradeId = `sim_${crypto.randomUUID()}`;

    const result: SimulatedExecutionResult = {
      tradeId,
      tokenMint: request.tokenMint,
      tokenSymbol: request.tokenSymbol,
      side: request.side,
      requestedPriceSol: request.currentPriceSol,
      executedPriceSol,
      amountTokens,
      totalSol,
      simulatedFeeSol: this.config.simulatedFeeSol,
      slippageBpsApplied: slippageBps,
      reason: request.reason,
      executedAt: new Date(),
      isSimulated: true,
    };

    logger.info(
      {
        tradeId,
        side: result.side,
        mint: result.tokenMint,
        tokens: result.amountTokens,
        priceSol: result.executedPriceSol,
        feeSol: result.simulatedFeeSol,
      },
      '[PaperExecutionEngine] Simulated trade executed',
    );

    this.emitter.emit('trade', result);
    return result;
  }
}

export const paperExecutionEngine = new PaperExecutionEngine();
