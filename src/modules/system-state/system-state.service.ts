import crypto from 'node:crypto';
import type {
  SystemOperatingState,
  StateTransitionDetails,
  StateTransitionResult,
  HealthPrecheckResult,
  PendingConfigChange,
  ConfigParameterName,
} from './system-state.types.js';
import { ConfigValueValidators } from './system-state.types.js';
import { systemStateRepository, SystemStateRepository } from './system-state.repository.js';
import {
  portfolioRiskController,
  PortfolioRiskController,
} from '../risk/portfolio-risk-controller.js';
import { ingestionStreamService, IngestionStreamService } from '../ingestion/stream.service.js';
import { strategyService, StrategyService } from '../strategy/strategy.service.js';
import { configService } from '../configuration/config.service.js';
import { logger } from '../observability/logger.js';

export class SystemStateService {
  private currentState: SystemOperatingState = 'MONITORING';
  private lastTransition: StateTransitionDetails | null = null;
  private isTransitioning = false;
  private pendingChanges = new Map<string, PendingConfigChange>();
  private customConfig: {
    risk?: Record<string, unknown>;
    strategy?: Record<string, unknown>;
  } = {};

  private repository: SystemStateRepository;
  private riskController: PortfolioRiskController;
  private streamService: IngestionStreamService;
  private stratService: StrategyService;

  constructor(
    customRepo?: SystemStateRepository,
    customRisk?: PortfolioRiskController,
    customStream?: IngestionStreamService,
    customStrat?: StrategyService,
  ) {
    this.repository = customRepo ?? systemStateRepository;
    this.riskController = customRisk ?? portfolioRiskController;
    this.streamService = customStream ?? ingestionStreamService;
    this.stratService = customStrat ?? strategyService;
  }

  /**
   * Initializes state machine and restores persisted state across restarts.
   * Requirement 11: Persist operating state across restarts.
   */
  public async init(): Promise<void> {
    const saved = await this.repository.loadState();
    if (saved) {
      this.currentState = saved.state;
      this.customConfig = saved.customConfig ?? {};

      // Restore custom configuration overrides
      if (this.customConfig.risk) {
        this.riskController.updateConfig(this.customConfig.risk);
      }
      if (this.customConfig.strategy) {
        this.stratService.updateConfig(this.customConfig.strategy);
      }

      this.lastTransition = {
        fromState: 'STOPPED',
        toState: saved.state,
        reason: saved.reason || 'Restored from persisted storage',
        triggeredBy: saved.updatedBy,
        timestamp: new Date(saved.updatedAt),
        metadata: saved.metadata,
      };

      // Synchronize controller according to restored state
      if (this.currentState === 'PAUSED') {
        this.riskController.pauseTrading(
          saved.reason || 'Restored PAUSED state on restart',
          'MANUAL',
        );
      } else if (this.currentState === 'STOPPED') {
        this.riskController.pauseTrading('Restored STOPPED state on restart', 'MANUAL');
        void this.streamService.stop();
      } else if (this.currentState === 'ERROR') {
        this.riskController.pauseTrading('Restored ERROR state on restart', 'MANUAL');
      }

      logger.info(
        { state: this.currentState, updatedAt: saved.updatedAt },
        '[SystemStateService] Restored operating state from storage',
      );
    } else {
      // First boot: set default state to MONITORING and persist
      this.currentState = 'MONITORING';
      await this.persistState('Initial system startup', { userId: 0, username: 'system' });
    }
  }

  public getState(): SystemOperatingState {
    return this.currentState;
  }

  public getLastTransition(): StateTransitionDetails | null {
    return this.lastTransition ? { ...this.lastTransition } : null;
  }

  /**
   * Returns explicit policy description for how positions are monitored in the current state.
   * Requirement 5: Define whether existing paper positions continue to be monitored after stopping.
   */
  public getPositionMonitoringPolicy(): string {
    if (this.currentState === 'STOPPED') {
      return 'Protected Dormant: Existing paper positions remain guarded by stop-loss, take-profit & holding-time exits.';
    } else if (this.currentState === 'PAUSED') {
      return 'Active Dormant: Global entries paused; active positions monitor and execute exits normally.';
    }
    return 'Full Monitoring: Active risk management, dynamic trailing and exit triggers engaged.';
  }

  /**
   * Evaluates preconditions for /resume: healthy data sources and valid risk configuration.
   * Requirement 3: /resume requires healthy data sources and a valid risk configuration.
   */
  public evaluateResumePreconditions(): HealthPrecheckResult {
    // 1. Data Source Health Check
    const streamHealth = this.streamService.getHealth();
    let isDataHealthy = true;
    let dataDetails = `Provider: ${streamHealth.name} (${streamHealth.status})`;

    if (streamHealth.status === 'ERROR') {
      isDataHealthy = false;
      dataDetails = `Data provider ${streamHealth.name} is in ERROR status. Stream is offline.`;
    } else if (streamHealth.status === 'DISCONNECTED' && this.streamService.running) {
      isDataHealthy = false;
      dataDetails = `Data provider ${streamHealth.name} is currently DISCONNECTED.`;
    } else if (streamHealth.latencyMs > 5000) {
      isDataHealthy = false;
      dataDetails = `Data provider latency (${streamHealth.latencyMs}ms) exceeds max allowed threshold (5000ms).`;
    }

    // 2. Risk Configuration Validity Check
    const riskConfig = this.riskController.getConfig();
    let isRiskValid = true;
    const riskIssues: string[] = [];

    if (
      typeof riskConfig.stopLossPct !== 'number' ||
      riskConfig.stopLossPct <= 0 ||
      riskConfig.stopLossPct > 50
    ) {
      isRiskValid = false;
      riskIssues.push(`Invalid stop-loss: ${riskConfig.stopLossPct}% (must be 1-50%)`);
    }
    if (
      typeof riskConfig.takeProfitPct !== 'number' ||
      riskConfig.takeProfitPct <= 0 ||
      riskConfig.takeProfitPct > 500
    ) {
      isRiskValid = false;
      riskIssues.push(`Invalid take-profit: ${riskConfig.takeProfitPct}% (must be 5-500%)`);
    }
    if (
      typeof riskConfig.maxHoldingDurationMs !== 'number' ||
      riskConfig.maxHoldingDurationMs < 10000
    ) {
      isRiskValid = false;
      riskIssues.push(`Holding duration ${riskConfig.maxHoldingDurationMs}ms below 10s min`);
    }
    if (
      typeof riskConfig.maxDailyLossPct !== 'number' ||
      riskConfig.maxDailyLossPct <= 0 ||
      riskConfig.maxDailyLossPct > 50
    ) {
      isRiskValid = false;
      riskIssues.push(`Invalid daily loss limit: ${riskConfig.maxDailyLossPct}%`);
    }
    if (
      typeof riskConfig.maxDrawdownPct !== 'number' ||
      riskConfig.maxDrawdownPct <= 0 ||
      riskConfig.maxDrawdownPct > 50
    ) {
      isRiskValid = false;
      riskIssues.push(`Invalid drawdown limit: ${riskConfig.maxDrawdownPct}%`);
    }
    if (typeof riskConfig.maxPositionSizeSol !== 'number' || riskConfig.maxPositionSizeSol <= 0) {
      isRiskValid = false;
      riskIssues.push(`Invalid max position size: ${riskConfig.maxPositionSizeSol} SOL`);
    }
    if (
      typeof riskConfig.maxConcurrentPositions !== 'number' ||
      riskConfig.maxConcurrentPositions < 1
    ) {
      isRiskValid = false;
      riskIssues.push(`Invalid concurrent positions: ${riskConfig.maxConcurrentPositions}`);
    }

    const riskDetails = isRiskValid
      ? 'All portfolio-risk thresholds verified and within safe experimental bounds.'
      : `Risk config validation failed: ${riskIssues.join('; ')}`;

    return {
      healthy: isDataHealthy && isRiskValid,
      dataSourceStatus: isDataHealthy ? 'ok' : 'down',
      dataSourceDetails: dataDetails,
      riskConfigValid: isRiskValid,
      riskConfigDetails: riskDetails,
    };
  }

  /**
   * Executes a state transition with concurrency lock and duplicate prevention.
   * Requirements 1, 10, 11, 12.
   */
  private async transitionTo(
    toState: SystemOperatingState,
    reason: string,
    triggeredBy: { userId: number; username?: string },
    metadata?: Record<string, unknown>,
  ): Promise<StateTransitionResult> {
    // 1. Authorization check (Requirement 1)
    if (triggeredBy.userId !== 0 && !configService.isAuthorizedUser(triggeredBy.userId)) {
      logger.warn(
        { userId: triggeredBy.userId, toState },
        '[SystemStateService] Unauthorized state transition attempt blocked',
      );
      return {
        success: false,
        fromState: this.currentState,
        toState,
        message: '⛔ Unauthorized: You do not have permission to change system state.',
        error: 'UNAUTHORIZED',
      };
    }

    // 2. Concurrency lock to prevent command races (Requirement 10)
    if (this.isTransitioning) {
      logger.warn(
        { userId: triggeredBy.userId, toState },
        '[SystemStateService] Concurrent state transition rejected (lock active)',
      );
      return {
        success: false,
        fromState: this.currentState,
        toState,
        message: '⏳ Another state transition is currently in progress. Please wait a moment.',
        error: 'CONCURRENT_TRANSITION_IN_PROGRESS',
      };
    }

    // 3. Duplicate state change check (Requirement 10)
    if (this.currentState === toState) {
      return {
        success: false,
        fromState: this.currentState,
        toState,
        duplicate: true,
        message: `ℹ️ System is already in <b>${toState}</b> state. No state transition was performed.`,
      };
    }

    this.isTransitioning = true;
    const fromState = this.currentState;

    try {
      const now = new Date();
      const transition: StateTransitionDetails = {
        fromState,
        toState,
        reason,
        triggeredBy,
        timestamp: now,
        metadata,
      };

      // Apply state change effects
      if (toState === 'PAUSED') {
        this.riskController.pauseTrading(reason, 'MANUAL');
      } else if (toState === 'STOPPED') {
        // Requirement 4: Stop monitoring and new entries
        await this.streamService.stop();
        this.riskController.pauseTrading(reason, 'MANUAL');
      } else if (toState === 'MONITORING') {
        // Start stream if stopped
        if (!this.streamService.running) {
          await this.streamService.start();
        }
        this.riskController.resumeTrading(reason);
      } else if (toState === 'ERROR') {
        this.riskController.pauseTrading(`Critical error: ${reason}`, 'MANUAL');
      }

      this.currentState = toState;
      this.lastTransition = transition;

      // Requirement 11: Persist state across restarts
      await this.persistState(reason, triggeredBy, metadata);

      // Requirement 12: Record audit trail
      await this.repository.recordAudit({
        id: `audit_${crypto.randomUUID()}`,
        userId: triggeredBy.userId,
        username: triggeredBy.username,
        command: toState.toLowerCase(),
        args: [reason],
        status: 'SUCCESS',
        durationMs: Date.now() - now.getTime(),
        timestamp: now,
      });

      logger.info(
        { fromState, toState, reason, operator: triggeredBy.username ?? triggeredBy.userId },
        '[SystemStateService] System operating state transition completed',
      );

      return {
        success: true,
        fromState,
        toState,
        message: `System operating state transitioned from <b>${fromState}</b> to <b>${toState}</b>.`,
        transition,
      };
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Pauses trading immediately (Requirement 2).
   */
  public async pause(
    userId: number,
    username?: string,
    reason?: string,
  ): Promise<StateTransitionResult> {
    const pauseReason = reason ?? `Manual pause by Telegram operator ${username ?? userId}`;
    return await this.transitionTo('PAUSED', pauseReason, { userId, username });
  }

  /**
   * Resumes trading (Requirement 3: requires healthy data sources and valid risk config).
   */
  public async resume(
    userId: number,
    username?: string,
    reason?: string,
  ): Promise<StateTransitionResult> {
    const resumeReason = reason ?? `Manual resume by Telegram operator ${username ?? userId}`;

    // Requirement 3 verification
    const precheck = this.evaluateResumePreconditions();
    if (!precheck.healthy) {
      logger.warn(
        { precheck, userId },
        '[SystemStateService] Resume rejected due to unhealthy preconditions',
      );
      return {
        success: false,
        fromState: this.currentState,
        toState: 'MONITORING',
        message:
          `❌ <b>Cannot Resume Global Operations:</b>\n\n` +
          `• <b>Data Sources:</b> ${precheck.dataSourceStatus === 'ok' ? '✅ HEALTHY' : '❌ UNHEALTHY'}\n` +
          `  <i>${precheck.dataSourceDetails}</i>\n\n` +
          `• <b>Risk Configuration:</b> ${precheck.riskConfigValid ? '✅ VALID' : '❌ INVALID'}\n` +
          `  <i>${precheck.riskConfigDetails}</i>\n\n` +
          `⚠️ Resolve the above conditions before resuming trading.`,
        error: 'PRECONDITIONS_NOT_MET',
      };
    }

    return await this.transitionTo('MONITORING', resumeReason, { userId, username });
  }

  /**
   * Stops monitoring and new entries (Requirement 4 & 5).
   */
  public async stop(
    userId: number,
    username?: string,
    reason?: string,
  ): Promise<StateTransitionResult> {
    const stopReason = reason ?? `Manual stop by Telegram operator ${username ?? userId}`;
    return await this.transitionTo('STOPPED', stopReason, { userId, username });
  }

  /**
   * Transitions system to ERROR on critical subsystem failure.
   */
  public async setError(
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<StateTransitionResult> {
    return await this.transitionTo(
      'ERROR',
      reason,
      { userId: 0, username: 'system_monitor' },
      metadata,
    );
  }

  // =========================================================================
  // Configuration Changes (Requirement 8)
  // Two-phase proposal & confirmation workflow
  // Protects against accidental changes & strictly forbids real-money trading
  // =========================================================================

  /**
   * Proposes a configuration change, validating input and generating a confirmation token.
   */
  public proposeConfigChange(
    userId: number,
    username: string | undefined,
    param: string,
    rawValue: string,
  ): {
    success: boolean;
    token?: string;
    message: string;
    param?: ConfigParameterName;
    oldValue?: unknown;
    newValue?: unknown;
    expiresInSec?: number;
  } {
    // 1. Authorization check
    if (!configService.isAuthorizedUser(userId)) {
      return {
        success: false,
        message: '⛔ Unauthorized: You do not have permission to modify configuration settings.',
      };
    }

    // 2. Strict Safety Invariant: Reject any attempt to enable real-money trading or private keys
    const lowerParam = param.toLowerCase().trim();
    const lowerVal = rawValue.toLowerCase().trim();
    if (
      lowerParam.includes('real') ||
      lowerParam.includes('live') ||
      lowerParam.includes('key') ||
      lowerParam.includes('wallet') ||
      lowerVal.includes('real') ||
      lowerVal.includes('live') ||
      lowerParam.includes('paper') ||
      lowerParam.includes('mode')
    ) {
      logger.warn(
        { userId, param, rawValue },
        '[SystemStateService] Blocked attempt to set forbidden real-money trading parameter',
      );
      return {
        success: false,
        message:
          '⛔ <b>Security Violation:</b> No Telegram command may enable real-money trading or accept private keys.\n' +
          'PumpSentinel operates <b>strictly in simulated paper-trading mode</b> with zero real funds.',
      };
    }

    // 3. Validate parameter name
    const validator = ConfigValueValidators[param as ConfigParameterName];
    if (!validator) {
      const allowed = Object.keys(ConfigValueValidators)
        .map((k) => `• <code>${k}</code>`)
        .join('\n');
      return {
        success: false,
        message: `❌ <b>Unknown Parameter:</b> <code>${param}</code>\n\n<b>Allowed parameters:</b>\n${allowed}`,
      };
    }

    // 4. Validate value using Zod schema
    const parseRes = validator.safeParse(rawValue);
    if (!parseRes.success) {
      const err = parseRes.error.issues.map((i) => i.message).join('; ');
      return {
        success: false,
        message: `❌ <b>Invalid Value for ${param}:</b> ${err}`,
      };
    }

    const validatedValue = parseRes.data;
    const oldValue = this.getCurrentConfigValue(param as ConfigParameterName);

    // 5. Generate secure confirmation token (expires in 60 seconds)
    const token = `cfg_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60000); // 60s

    this.pendingChanges.set(token, {
      token,
      userId,
      username,
      parameter: param,
      oldValue,
      newValue: validatedValue,
      createdAt: now,
      expiresAt,
    });

    logger.info(
      { param, oldValue, newValue: validatedValue, token, userId },
      '[SystemStateService] Configuration change proposed and awaiting confirmation',
    );

    return {
      success: true,
      token,
      param: param as ConfigParameterName,
      oldValue,
      newValue: validatedValue,
      expiresInSec: 60,
      message:
        `⚠️ <b>Configuration Change Confirmation Required</b>\n\n` +
        `• <b>Parameter:</b> <code>${param}</code>\n` +
        `• <b>Current Value:</b> <code>${String(oldValue)}</code>\n` +
        `• <b>Proposed Value:</b> <b>${String(validatedValue)}</b>\n` +
        `• <b>Confirmation Token:</b> <code>${token}</code>\n` +
        `• <b>Expires In:</b> 60 seconds\n\n` +
        `To confirm and apply this change, run:\n` +
        `<code>/confirm ${token}</code>\n\n` +
        `To cancel, run:\n` +
        `<code>/cancel</code>`,
    };
  }

  /**
   * Confirms and applies a pending configuration change.
   */
  public async confirmConfigChange(
    userId: number,
    username: string | undefined,
    token: string,
  ): Promise<{
    success: boolean;
    message: string;
    param?: string;
    newValue?: unknown;
  }> {
    // 1. Authorization check
    if (!configService.isAuthorizedUser(userId)) {
      return {
        success: false,
        message: '⛔ Unauthorized: You do not have permission to confirm configuration changes.',
      };
    }

    // 2. Token lookup
    const pending = this.pendingChanges.get(token);
    if (!pending) {
      return {
        success: false,
        message:
          '❌ <b>Invalid or Expired Token:</b> No pending configuration change matches this token.\n' +
          'Propose a new change with: <code>/set &lt;param&gt; &lt;value&gt;</code>',
      };
    }

    // 3. Expiration check
    if (Date.now() > pending.expiresAt.getTime()) {
      this.pendingChanges.delete(token);
      return {
        success: false,
        message:
          '⏱ <b>Confirmation Token Expired:</b> The 60-second confirmation window has elapsed. Please propose the change again.',
      };
    }

    // 4. Apply change to active subsystems
    const { parameter, newValue, oldValue } = pending;
    this.applyConfigValue(parameter as ConfigParameterName, newValue);

    // Clean up pending token
    this.pendingChanges.delete(token);

    // 5. Persist custom configuration to survive restarts (Requirement 11)
    await this.persistState(`Configuration change: ${parameter} = ${String(newValue)}`, {
      userId,
      username,
    });

    // 6. Record audit trail (Requirement 12)
    await this.repository.recordAudit({
      id: `audit_${crypto.randomUUID()}`,
      userId,
      username,
      command: 'confirm',
      args: [token, parameter, String(newValue)],
      status: 'SUCCESS',
      durationMs: 0,
      timestamp: new Date(),
    });

    logger.info(
      { parameter, oldValue, newValue, userId, username },
      '[SystemStateService] Configuration change applied and persisted',
    );

    return {
      success: true,
      param: parameter,
      newValue,
      message:
        `✅ <b>Configuration Updated Successfully</b>\n\n` +
        `• <b>Parameter:</b> <code>${parameter}</code>\n` +
        `• <b>Previous Value:</b> <code>${String(oldValue)}</code>\n` +
        `• <b>New Active Value:</b> <b>${String(newValue)}</b>\n` +
        `• <b>Persistence:</b> Applied across active memory and persisted across restarts.`,
    };
  }

  /**
   * Cancels any pending configuration changes for the user.
   */
  public cancelConfigChange(userId: number): { success: boolean; message: string } {
    let cancelled = 0;
    for (const [token, pending] of this.pendingChanges.entries()) {
      if (pending.userId === userId) {
        this.pendingChanges.delete(token);
        cancelled++;
      }
    }

    if (cancelled === 0) {
      return {
        success: true,
        message: 'ℹ️ No pending configuration changes were found to cancel.',
      };
    }

    return {
      success: true,
      message: `🚫 <b>Cancelled:</b> ${cancelled} pending configuration change(s) discarded.`,
    };
  }

  private getCurrentConfigValue(param: ConfigParameterName): unknown {
    const risk = this.riskController.getConfig();
    const strat = this.stratService.getConfig();

    switch (param) {
      case 'stop_loss':
        return risk.stopLossPct;
      case 'take_profit':
        return risk.takeProfitPct;
      case 'max_holding_time_sec':
        return Math.round(risk.maxHoldingDurationMs / 1000);
      case 'max_daily_loss':
        return risk.maxDailyLossPct;
      case 'max_drawdown':
        return risk.maxDrawdownPct;
      case 'max_position_size':
        return risk.maxPositionSizeSol;
      case 'max_concurrent_positions':
        return risk.maxConcurrentPositions;
      case 'max_total_exposure_pct':
        return risk.maxTotalExposurePct;
      case 'auto_trade':
        return strat.autoTradeEnabled;
      case 'fixed_buy_amount':
        return strat.fixedBuyAmountSol;
    }
  }

  private applyConfigValue(param: ConfigParameterName, value: unknown): void {
    if (!this.customConfig.risk) this.customConfig.risk = {};
    if (!this.customConfig.strategy) this.customConfig.strategy = {};

    switch (param) {
      case 'stop_loss':
        this.riskController.updateConfig({ stopLossPct: Number(value) });
        this.customConfig.risk['stopLossPct'] = Number(value);
        break;
      case 'take_profit':
        this.riskController.updateConfig({ takeProfitPct: Number(value) });
        this.customConfig.risk['takeProfitPct'] = Number(value);
        break;
      case 'max_holding_time_sec':
        this.riskController.updateConfig({ maxHoldingDurationMs: Number(value) * 1000 });
        this.customConfig.risk['maxHoldingDurationMs'] = Number(value) * 1000;
        break;
      case 'max_daily_loss':
        this.riskController.updateConfig({ maxDailyLossPct: Number(value) });
        this.customConfig.risk['maxDailyLossPct'] = Number(value);
        break;
      case 'max_drawdown':
        this.riskController.updateConfig({ maxDrawdownPct: Number(value) });
        this.customConfig.risk['maxDrawdownPct'] = Number(value);
        break;
      case 'max_position_size':
        this.riskController.updateConfig({ maxPositionSizeSol: Number(value) });
        this.customConfig.risk['maxPositionSizeSol'] = Number(value);
        break;
      case 'max_concurrent_positions':
        this.riskController.updateConfig({ maxConcurrentPositions: Number(value) });
        this.customConfig.risk['maxConcurrentPositions'] = Number(value);
        break;
      case 'max_total_exposure_pct':
        this.riskController.updateConfig({ maxTotalExposurePct: Number(value) });
        this.customConfig.risk['maxTotalExposurePct'] = Number(value);
        break;
      case 'auto_trade':
        this.stratService.updateConfig({ autoTradeEnabled: Boolean(value) });
        this.customConfig.strategy['autoTradeEnabled'] = Boolean(value);
        break;
      case 'fixed_buy_amount':
        this.stratService.updateConfig({ fixedBuyAmountSol: Number(value) });
        this.customConfig.strategy['fixedBuyAmountSol'] = Number(value);
        break;
    }
  }

  private async persistState(
    reason: string,
    updatedBy: { userId: number; username?: string },
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.saveState({
      state: this.currentState,
      updatedAt: new Date().toISOString(),
      updatedBy,
      reason,
      metadata,
      customConfig: this.customConfig,
    });
  }
}

export const systemStateService = new SystemStateService();
