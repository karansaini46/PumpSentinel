import {
  DISCRIMINATORS,
  matchesDiscriminator,
  decodeCreateEvent,
  decodeTradeEvent,
  type DecodedCreateEvent,
  type DecodedTradeEvent,
} from './pump-fun-layout.js';
import { logger } from '../../observability/logger.js';

export type ParsedPumpFunEvent =
  | { type: 'CREATE'; event: DecodedCreateEvent; rawData: string }
  | { type: 'TRADE'; event: DecodedTradeEvent; rawData: string };

export class PumpFunDecoder {
  /**
   * Parse Solana transaction execution logs looking for Anchor 'Program data: ' events
   */
  public parseLogs(logs: string[]): ParsedPumpFunEvent[] {
    const events: ParsedPumpFunEvent[] = [];

    for (const log of logs) {
      if (!log.startsWith('Program data: ')) {
        continue;
      }

      const base64Data = log.slice('Program data: '.length).trim();
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length < 8) continue;

        if (matchesDiscriminator(buffer, DISCRIMINATORS.CREATE_EVENT)) {
          const createEvent = decodeCreateEvent(buffer);
          events.push({
            type: 'CREATE',
            event: createEvent,
            rawData: base64Data,
          });
        } else if (matchesDiscriminator(buffer, DISCRIMINATORS.TRADE_EVENT)) {
          const tradeEvent = decodeTradeEvent(buffer);
          events.push({
            type: 'TRADE',
            event: tradeEvent,
            rawData: base64Data,
          });
        }
      } catch (err) {
        logger.debug(
          { err, logSnippet: log.slice(0, 50) },
          '[PumpFunDecoder] Error decoding log event',
        );
      }
    }

    return events;
  }
}

export const pumpFunDecoder = new PumpFunDecoder();
