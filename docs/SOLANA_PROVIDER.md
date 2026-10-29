# Solana Data Access Layer & Provider Documentation

PumpSentinel features a modular, pluggable data-access architecture for monitoring on-chain [pump.fun](https://pump.fun) token launches and trade events on Solana.

---

## 1. Provider Interface (`ISolanaDataProvider`)

All data sources adhere to the [`ISolanaDataProvider`](file:///home/karan/Desktop/PumpSentinel/src/modules/ingestion/providers/provider.interface.ts) contract. This decouples the core risk engine and paper execution system from specific RPC vendors:

```typescript
export interface ISolanaDataProvider {
  readonly name: string;
  readonly source: EventSource;
  getStatus(): ProviderStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  ping(): Promise<number>;
  getHealth(): ProviderHealthReport;
  getMetrics(): IngestionMetrics;

  onTokenCreated(handler: (event: IngestionTokenCreatedEvent) => void | Promise<void>): () => void;
  onTrade(handler: (event: IngestionTradeEvent) => void | Promise<void>): () => void;
}
```

### Available Providers

1. **`HeliusSolanaProvider`**: High-performance primary provider combining Helius WebSocket (`logsSubscribe`) and HTTP JSON-RPC with automated heartbeat, reconnection, and Anchor log decoding.
2. **`PollingSolanaProvider`**: Periodic reconciliation provider polling `getSignaturesForAddress` and `getTransaction` at configurable intervals (useful when WebSockets are blocked or unstable).
3. **`MockSolanaProvider`**: Deterministic offline provider for unit tests and local simulation without external network dependencies.

---

## 2. Pump.fun Program Layout & Technical Specifications

> **Notice**: Program addresses and binary layouts are verified against the official Anchor IDL for pump.fun.

- **Program ID**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- **Anchor Log Format**: Solana programs emit structured event data via `msg!("Program data: {}", base64_payload)`.

### Event Discriminators

Each event payload begins with an 8-byte discriminator equal to `sha256("event:<EventName>")[0..8]`:

| Event | Hex Discriminator | Bytes (Decimal) | Borsh Layout |
| :--- | :--- | :--- | :--- |
| **`CreateEvent`** | `1b72a94ddeeb6376` | `[27, 114, 169, 77, 222, 235, 99, 118]` | `name` (string), `symbol` (string), `uri` (string), `mint` (Pubkey 32B), `bondingCurve` (Pubkey 32B), `user` (Pubkey 32B) |
| **`TradeEvent`** | `bddb7fd34ee661ee` | `[189, 219, 127, 211, 78, 230, 105, 238]` | `mint` (Pubkey 32B), `solAmount` (u64 LE), `tokenAmount` (u64 LE), `isBuy` (bool 1B), `user` (Pubkey 32B), `timestamp` (i64), reserves... |

---

## 3. Rate Limits & Vendor Constraints

### Helius RPC
- **Developer / Free Tier**: Typically capped at **10–20 requests per second (RPS)** and 5–10 concurrent WebSocket connections.
- **Paid Plans**: Support 50–500 RPS and higher connection concurrency.
- **Handling in PumpSentinel**:
  - Request throttling enforced by [`RateLimiter`](file:///home/karan/Desktop/PumpSentinel/src/modules/ingestion/transport/rate-limiter.ts) via token-bucket algorithm (`RPC_MAX_REQUESTS_PER_SECOND`).
  - Automatic backoff on HTTP `429 Too Many Requests` respecting `Retry-After` response headers.
  - Exponential backoff with random jitter across bounded retries (`RPC_MAX_RETRIES`).

### Public Solana RPC (`api.mainnet-beta.solana.com`)
- **Severe Throttling**: Public endpoints enforce aggressive IP rate limits (40 requests per 10 seconds) and will return HTTP 429 or 403 on sustained load.
- **Recommendation**: For production monitoring, provide a dedicated Helius API key or private RPC endpoint via `HELIUS_API_KEY` or `HELIUS_RPC_HTTP_URL`.

---

## 4. WebSocket Resilience & Limitations

1. **Silent Dropped Connections**:
   - WebSocket TCP sockets can hang without a clean `close` packet (half-open state).
   - [`SolanaWsConnection`](file:///home/karan/Desktop/PumpSentinel/src/modules/ingestion/transport/ws-connection.ts) sends periodic `ping` frames every 20 seconds. If a `pong` is not received within 10 seconds, the socket is terminated and triggers an exponential-backoff reconnect.
2. **Log Truncation in Standard RPC**:
   - Solana validators truncate transaction logs if they exceed total byte thresholds.
   - In rare cases where a token launch occurs in a complex transaction and `Program data:` is omitted from the log notification, [`PollingSolanaProvider`](file:///home/karan/Desktop/PumpSentinel/src/modules/ingestion/providers/polling-provider.ts) or fallback transaction fetching decodes the instruction accounts directly.
3. **Duplicate Event Prevention**:
   - Solana RPC log subscriptions can deliver the same signature multiple times (especially during cluster forks/reorgs).
   - [`EventDeduplicator`](file:///home/karan/Desktop/PumpSentinel/src/modules/ingestion/transport/deduplicator.ts) maintains a bounded LRU/TTL cache of processed transaction signatures to guarantee idempotency.

---

## 5. Security & Credentials

- API keys (such as `HELIUS_API_KEY`) are kept strictly server-side.
- The logger automatically redacts sensitive parameters from URLs and headers (`[REDACTED]`).
- Health probes report `sanitizedEndpoint` without exposing tokens or secrets.
