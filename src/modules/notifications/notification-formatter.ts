import type {
  TokenAlertPayload,
  SimulatedTradeAlertPayload,
  SystemAlertPayload,
  NotificationPriority,
  NotificationCategory,
} from './notifications.types.js';
import {
  escapeHtml,
  sanitizeSecrets,
  shortenAddress,
  formatSol,
  formatUsd,
  formatPct,
} from '../telegram/telegram-utils.js';

export interface FormattedNotificationResult {
  title: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  html: string;
  dedupeKey: string;
}

/**
 * Formats token lifecycle alerts: Discovery, Risk Rejection, and Strategy Eligibility.
 * Satisfies all required token fields:
 * - Token mint address
 * - Discovery timestamp
 * - Creator address when available
 * - Liquidity and data freshness
 * - Risk-check summary
 * - Decision
 * - Reason for the decision
 * - Relevant market-data source
 */
export function formatTokenAlert(payload: TokenAlertPayload): FormattedNotificationResult {
  const isEligible = payload.decision === 'ELIGIBLE_FOR_STRATEGY';
  const isRejected = payload.decision === 'REJECT';
  const isRecheck = payload.decision === 'NEEDS_RECHECK';

  let icon = '🔍';
  let badge = 'DISCOVERED';
  let priority: NotificationPriority = 'LOW';

  if (isEligible) {
    icon = '🟢';
    badge = 'STRATEGY ELIGIBLE';
    priority = 'MEDIUM';
  } else if (isRejected) {
    icon = '🛡️';
    badge = 'RISK REJECTED';
    priority = 'MEDIUM';
  } else if (isRecheck) {
    icon = '🟡';
    badge = 'NEEDS RECHECK';
    priority = 'MEDIUM';
  }

  const discDate =
    typeof payload.discoveryTimestamp === 'number'
      ? new Date(payload.discoveryTimestamp)
      : payload.discoveryTimestamp;
  const timeStr = discDate.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const freshnessStr =
    payload.dataFreshnessMs !== undefined ? `${payload.dataFreshnessMs}ms` : 'Live Stream';

  const creatorStr = payload.creator ? shortenAddress(payload.creator) : 'Unknown';

  const synthBadge = payload.isSynthetic ? ' [SYNTHETIC]' : '';

  const decisionBadge = isEligible
    ? '🟢 <b>ELIGIBLE_FOR_STRATEGY</b>'
    : isRejected
      ? '🔴 <b>REJECT</b>'
      : isRecheck
        ? '🟡 <b>NEEDS_RECHECK</b>'
        : '⚪ <b>DISCOVERED</b>';

  const title = `${icon} [PAPER] Token ${badge}: ${payload.symbol}`;

  const lines = [
    `${icon} <b>[PAPER] Token ${badge}</b> — <b>${escapeHtml(payload.symbol)}</b>${synthBadge}`,
    `• Mint: <code>${payload.mint}</code>`,
    `• Discovered: <code>${timeStr}</code>${payload.slot ? ` (Slot: ${payload.slot})` : ''}`,
    `• Creator: <code>${creatorStr}</code>`,
    `• Liquidity: <b>${formatSol(payload.liquiditySol)} SOL</b> | Freshness: <b>${freshnessStr}</b>`,
    payload.riskSummary
      ? `• Risk Summary: <b>${escapeHtml(payload.riskSummary)}</b>${payload.riskScore !== undefined ? ` (Score: ${payload.riskScore}/100)` : ''}`
      : `• Risk Assessment: ${payload.riskScore !== undefined ? `Score: ${payload.riskScore}/100` : 'Pending Deep Analysis'}`,
    `• Decision: ${decisionBadge}`,
    `• Reason: <i>${escapeHtml(payload.decisionReason)}</i>`,
    `• Market Data Source: <code>${escapeHtml(payload.marketDataSource)}</code>`,
  ];

  const html = sanitizeSecrets(lines.join('\n'));
  const dedupeKey = `token:${payload.mint}:${payload.decision}`;

  return {
    title,
    category: isRejected || isRecheck ? 'RISK_ALERT' : 'TOKEN_ALERT',
    priority,
    html,
    dedupeKey,
  };
}

/**
 * Helper to format SOL prices with high precision for micro-cap meme tokens.
 */
export function formatPriceSol(amount: number): string {
  if (!amount || isNaN(amount)) return '0.0000';
  if (amount >= 1) return amount.toFixed(4);
  if (amount >= 0.001) return amount.toFixed(4);
  if (amount >= 0.000001) return amount.toFixed(6);
  return amount.toFixed(8);
}

/**
 * Formats simulated paper-trading alerts (Buys, Sells, Stop-Loss, Take-Profit, Emergency Exits).
 * Satisfies:
 * - Requirement 1: Never claim an order filled when it was only requested
 * - Requirement 2: Clearly label every trade as PAPER
 * - Entry or exit price
 * - Position size
 * - Fees and estimated slippage
 * - Realized or unrealized P&L
 * - Exit reason when applicable
 */
export function formatTradeAlert(payload: SimulatedTradeAlertPayload): FormattedNotificationResult {
  const isBuy = payload.side === 'BUY';
  const isRequested = payload.stage === 'REQUESTED';

  // Determine specific trigger badge
  const reasonLower = (payload.exitReason ?? '').toLowerCase();
  const isStopLoss = reasonLower.includes('stop-loss') || reasonLower.includes('stop loss');
  const isTakeProfit = reasonLower.includes('take-profit') || reasonLower.includes('take profit');
  const isEmergency = reasonLower.includes('emergency') || reasonLower.includes('exit_pending');

  let titleBadge = 'TRADE';
  let icon = '📄';
  let priority: NotificationPriority = 'HIGH';

  if (isRequested) {
    icon = '📋';
    titleBadge = isBuy ? 'BUY REQUESTED' : 'SELL REQUESTED';
    priority = 'MEDIUM';
  } else if (isEmergency) {
    icon = '🚨';
    titleBadge = 'EMERGENCY EXIT FILLED';
    priority = 'CRITICAL';
  } else if (isStopLoss) {
    icon = '🛑';
    titleBadge = 'STOP-LOSS TRIGGERED';
    priority = 'HIGH';
  } else if (isTakeProfit) {
    icon = '🎯';
    titleBadge = 'TAKE-PROFIT TRIGGERED';
    priority = 'HIGH';
  } else if (isBuy) {
    icon = '🔵';
    titleBadge = 'BUY FILLED';
    priority = 'HIGH';
  } else {
    icon = '🟢';
    titleBadge = 'SELL FILLED';
    priority = 'HIGH';
  }

  const title = `${icon} [PAPER] ${titleBadge}: ${payload.tokenSymbol}`;

  const lines: string[] = [
    `${icon} <b>[PAPER ${titleBadge}]</b> — <b>${escapeHtml(payload.tokenSymbol)}</b>`,
    `• Mint: <code>${payload.tokenMint}</code>`,
  ];

  if (isRequested) {
    // REQUIREMENT 1: Explicitly state order was only REQUESTED, not filled!
    lines.push(
      `• Order Status: <b>REQUESTED (Awaiting Simulation Fill)</b>`,
      `• Side: <b>${payload.side}</b>`,
      `• Target Size: <b>${payload.amountTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} TOKENS (${formatSol(payload.totalSol)} SOL)</b>`,
      `• Expected Price: <code>${formatPriceSol(payload.executedPriceSol)} SOL</code>`,
      `• Est. Max Slippage: <b>${payload.slippageBps} bps</b>`,
      payload.exitReason ? `• Reason: <i>${escapeHtml(payload.exitReason)}</i>` : '',
      `⚠️ <i>SIMULATED ORDER REQUESTED — NOT YET FILLED</i>`,
    );
  } else {
    // FILLED trade: show realistic execution numbers
    const priceSolStr = formatPriceSol(payload.executedPriceSol);
    const priceUsdStr = payload.executedPriceUsd
      ? ` ($${formatUsd(payload.executedPriceUsd)})`
      : '';

    lines.push(
      `• Execution Status: <b>FILLED (SIMULATED)</b>`,
      isBuy
        ? `• Simulated Entry Price: <code>${priceSolStr} SOL</code>${priceUsdStr}`
        : `• Simulated Exit Price: <code>${priceSolStr} SOL</code>${priceUsdStr}`,
    );

    if (!isBuy && payload.entryPriceSol) {
      lines.push(
        `• Original Entry Price: <code>${formatPriceSol(payload.entryPriceSol)} SOL</code>`,
      );
    }

    lines.push(
      `• Position Size: <b>${payload.amountTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} TOKENS</b> (${formatSol(payload.totalSol)} SOL)`,
      `• Simulated Fee: <code>${formatSol(payload.simulatedFeeSol)} SOL</code> | Slip Applied: <b>${payload.slippageBps} bps</b>`,
    );

    if (payload.realizedPnlSol !== undefined) {
      const pnlIcon = payload.realizedPnlSol >= 0 ? '🟢' : '🔴';
      const pctStr =
        payload.realizedPnlPct !== undefined ? ` (${formatPct(payload.realizedPnlPct)})` : '';
      const sign = payload.realizedPnlSol > 0 ? '+' : '';
      lines.push(
        `• Realized P&amp;L: ${pnlIcon} <b>${sign}${formatSol(payload.realizedPnlSol)} SOL</b>${pctStr}`,
      );
    } else if (payload.unrealizedPnlSol !== undefined) {
      const pnlIcon = payload.unrealizedPnlSol >= 0 ? '🟢' : '🔴';
      const pctStr =
        payload.unrealizedPnlPct !== undefined ? ` (${formatPct(payload.unrealizedPnlPct)})` : '';
      const sign = payload.unrealizedPnlSol > 0 ? '+' : '';
      lines.push(
        `• Unrealized P&amp;L: ${pnlIcon} <b>${sign}${formatSol(payload.unrealizedPnlSol)} SOL</b>${pctStr}`,
      );
    }

    if (payload.exitReason) {
      lines.push(`• Exit Reason: <i>${escapeHtml(payload.exitReason)}</i>`);
    }

    lines.push(`🔒 <i>SIMULATED PAPER EXECUTION ONLY — ZERO REAL FUNDS TOUCHED</i>`);
  }

  const html = sanitizeSecrets(lines.filter(Boolean).join('\n'));
  const dedupeKey = `trade:${payload.tradeId ?? payload.tokenMint}:${payload.side}:${payload.stage}`;

  return {
    title,
    category: 'TRADE_SIMULATION',
    priority,
    html,
    dedupeKey,
  };
}

/**
 * Formats critical operational system alerts (Provider outage, Stale data, Daily loss, Reconciliation errors).
 */
export function formatSystemAlert(payload: SystemAlertPayload): FormattedNotificationResult {
  let icon = '⚠️';
  let priority: NotificationPriority = 'HIGH';
  let header = payload.title;

  switch (payload.type) {
    case 'PROVIDER_OUTAGE':
      icon = '📡';
      priority = 'CRITICAL';
      header = 'DATA PROVIDER OUTAGE DETECTED';
      break;
    case 'DAILY_LOSS_LIMIT':
      icon = '🛑';
      priority = 'CRITICAL';
      header = 'DAILY SIMULATED LOSS LIMIT BREACHED';
      break;
    case 'RECONCILIATION_ERROR':
      icon = '🚨';
      priority = 'CRITICAL';
      header = 'PAPER-TRADING RECONCILIATION ERROR';
      break;
    case 'EMERGENCY_EXIT':
      icon = '🚨';
      priority = 'CRITICAL';
      header = 'EMERGENCY EXIT CONDITION TRIGGERED';
      break;
    case 'STALE_MARKET_DATA':
      icon = '⏳';
      priority = 'HIGH';
      header = 'STALE CRITICAL MARKET DATA';
      break;
  }

  const timeStr = payload.timestamp.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const lines = [
    `${icon} <b>[${priority}] ${header}</b>`,
    `• Subsystem: <b>${escapeHtml(payload.subsystem)}</b>`,
    `• Time: <code>${timeStr}</code>`,
    `• Details: ${escapeHtml(payload.details)}`,
  ];

  if (payload.error) {
    lines.push(`• Error: <code>${escapeHtml(payload.error)}</code>`);
  }

  if (payload.metrics) {
    const metricLines = Object.entries(payload.metrics)
      .slice(0, 5)
      .map(([k, v]) => `  — ${escapeHtml(k)}: <b>${escapeHtml(String(v))}</b>`);
    if (metricLines.length > 0) {
      lines.push('• Metrics Snapshot:', ...metricLines);
    }
  }

  lines.push('⚠️ <i>Immediate operator attention recommended.</i>');

  const html = sanitizeSecrets(lines.join('\n'));
  const dedupeKey = `system:${payload.type}:${payload.subsystem}:${payload.title}`;

  return {
    title: `${icon} [${priority}] ${header}`,
    category: 'SYSTEM_ALERT',
    priority,
    html,
    dedupeKey,
  };
}

/**
 * Formats a batch of low-priority token discoveries into a consolidated summary.
 * Requirement 6: Batch low-priority alerts.
 */
export function formatTokenBatch(payloads: TokenAlertPayload[]): FormattedNotificationResult {
  const count = payloads.length;
  const title = `📡 [PAPER] Batch: ${count} New Tokens Discovered`;

  const rows = payloads.slice(0, 8).map((p, idx) => {
    const creator = p.creator ? shortenAddress(p.creator) : 'Unknown';
    return (
      `<b>${idx + 1}. ${escapeHtml(p.symbol)}</b> (<code>${shortenAddress(p.mint)}</code>)\n` +
      `   • Liq: <b>${formatSol(p.liquiditySol)} SOL</b> | Creator: <code>${creator}</code>\n` +
      `   • Source: <code>${escapeHtml(p.marketDataSource)}</code>`
    );
  });

  const overflow = count > 8 ? `\n<i>...and ${count - 8} more tokens</i>\n` : '';

  const text = [
    `📡 <b>[PAPER] Batch Discovery Update (${count} Tokens)</b>`,
    '',
    rows.join('\n\n'),
    overflow,
    'ℹ️ <i>Low-priority alerts batched. Deep safety analysis running in background.</i>',
  ]
    .filter(Boolean)
    .join('\n');

  const html = sanitizeSecrets(text);
  const dedupeKey = `batch_tokens_${Date.now()}`;

  return {
    title,
    category: 'TOKEN_DISCOVERY',
    priority: 'LOW',
    html,
    dedupeKey,
  };
}
