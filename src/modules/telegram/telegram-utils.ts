/**
 * Telegram Utilities: Formatting, HTML Escaping, Secret Sanitization, and Message Pagination.
 */

/**
 * Escapes characters for Telegram HTML mode:
 * & -> &amp;, < -> &lt;, > -> &gt;
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  const text = String(str);
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Masks and sanitizes sensitive data (API keys, passwords, private keys, tokens)
 * to ensure secrets are never leaked in Telegram messages.
 */
export function sanitizeSecrets(text: string): string {
  if (!text) return '';

  return (
    text
      // Redact URL query parameter API keys (e.g. ?api-key=xyz or &api-key=xyz)
      .replace(/([?&](?:api[-_]?key|key|token|secret)=)[^&\s]+/gi, '$1***REDACTED***')
      // Redact PostgreSQL connection string passwords: postgresql://user:pass@host...
      .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1***REDACTED***$2')
      // Redact Telegram bot tokens: 123456789:ABCdef...
      .replace(/\b(\d{8,10}:)[A-Za-z0-9_-]{30,45}\b/g, '$1***REDACTED***')
      // Redact Solana base58 private key / seed phrase hints if present
      .replace(/(private[-_]?key\s*[:=]\s*)[^\s]+/gi, '$1***REDACTED***')
      .replace(/(seed[-_]?phrase\s*[:=]\s*)[^\n]+/gi, '$1***REDACTED***')
      // Redact general bearer tokens: Bearer xyz...
      .replace(/(Bearer\s+)[A-Za-z0-9_.-]+/gi, '$1***REDACTED***')
  );
}

/**
 * Splits a long Telegram message into safe chunks (<= maxLen chars)
 * respecting line breaks so message blocks are not cut awkwardly.
 */
export function chunkMessage(text: string, maxLen = 4000): string[] {
  if (!text || text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLen) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // If a single line itself is longer than maxLen, hard-slice it
      if (line.length > maxLen) {
        let remaining = line;
        while (remaining.length > maxLen) {
          chunks.push(remaining.slice(0, maxLen));
          remaining = remaining.slice(maxLen);
        }
        currentChunk = remaining;
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk = currentChunk.length === 0 ? line : `${currentChunk}\n${line}`;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Generic array pagination utility.
 */
export interface PaginationResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function paginateArray<T>(items: T[], page = 1, pageSize = 5): PaginationResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.min(Math.max(1, page), totalPages);

  const startIndex = (validPage - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page: validPage,
    pageSize,
    totalItems,
    totalPages,
    hasNext: validPage < totalPages,
    hasPrev: validPage > 1,
  };
}

/**
 * Formats a Solana address into a readable shortened format (e.g. 6EF8...F6P).
 */
export function shortenAddress(address: string, prefix = 6, suffix = 4): string {
  if (!address || address.length <= prefix + suffix) return address;
  return `${address.slice(0, prefix)}...${address.slice(-suffix)}`;
}

/**
 * Format SOL amounts cleanly with up to 4 decimal places.
 */
export function formatSol(amount: number): string {
  return amount.toFixed(4);
}

/**
 * Format USD amounts cleanly.
 */
export function formatUsd(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Format percentage with signed indicator (+/-).
 */
export function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
