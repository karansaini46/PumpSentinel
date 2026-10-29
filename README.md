# PumpSentinel 🛡️

Solana [pump.fun](https://pump.fun) token-monitoring and simulated paper-trading bot controlled entirely through Telegram.

> **CRITICAL SAFETY DIRECTIVE**: PumpSentinel strictly enforces **100% simulated paper trading**.
> It contains **NO** private keys, **NO** wallet signing, and **NO** real-money trading capabilities.
> Any attempt to supply private keys to the runtime environment triggers an immediate fatal assertion error.

---

## 🚀 Key Features

- **Telegram Bot Controlled**: Completely headless—no web dashboard or frontend needed. Control everything via Telegram commands.
- **Resource Optimized**: Specifically tuned for Ubuntu Linux laptops with **8 GB RAM** (lean memory cache limits, bounded collections, low-overhead logging, and tuned PostgreSQL container).
- **Strict Paper Trading**: Realistic order simulation with configurable slippage (basis points) and simulated network/priority fees.
- **Automated Risk Engine**: Evaluates holder distribution, developer wallet concentration, initial liquidity, snipers, and metadata completeness.
- **Strategy & Portfolio Tracking**: Automated take-profit and stop-loss evaluation, real-time unrealized and realized PnL accounting, and win-rate calculation.
- **Modular Architecture**: 13 isolated modules following strict TypeScript and dependency inversion patterns.

---

## 🧱 Module Architecture

The codebase is organized into 13 decoupled modules located under `src/modules/`:

| Module                  | Location                    | Responsibility                                                                                                                           |
| :---------------------- | :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Configuration**    | `src/modules/configuration` | Zod schema validation of environment variables and safety invariants.                                                                    |
| **2. Ingestion**        | `src/modules/ingestion`     | Solana data-access layer: Helius/RPC providers, Borsh log decoders, deduplication, & rate limiting ([details](docs/SOLANA_PROVIDER.md)). |
| **3. Discovery**        | `src/modules/discovery`     | Token discovery with LRU-bounded active cache (tuned for 8 GB RAM).                                                                      |
| **4. Metadata**         | `src/modules/metadata`      | Resolves offchain token URIs, social links, with timeout/circuit breakers.                                                               |
| **5. Holders**          | `src/modules/holders`       | Analyzes token holder concentration, dev wallet share, and sniper clusters.                                                              |
| **6. Risk Engine**      | `src/modules/risk`          | Configurable rules engine scoring tokens (0–100) and flagging high-risk launches.                                                        |
| **7. Trading Strategy** | `src/modules/strategy`      | Rule-based entry/exit signals (Take-Profit %, Stop-Loss %, max positions).                                                               |
| **8. Paper Execution**  | `src/modules/execution`     | Simulated order execution engine with slippage and fee models.                                                                           |
| **9. Portfolio**        | `src/modules/portfolio`     | Paper position management, mark-to-market valuations, and PnL metrics.                                                                   |
| **10. Telegram**        | `src/modules/telegram`      | Bot handlers, command registry, and authorized user access control.                                                                      |
| **11. Notifications**   | `src/modules/notifications` | Multi-channel alert dispatching with priority levels and history.                                                                        |
| **12. Persistence**     | `src/modules/persistence`   | Prisma ORM models for tokens, risk analyses, positions, and trades.                                                                      |
| **13. Observability**   | `src/modules/observability` | Pino structured logging, system metrics, and aggregate health checks.                                                                    |

---

## ⚙️ Tech Stack

- **Runtime**: Node.js LTS (ESM)
- **Language**: TypeScript 5 (Strict compiler settings)
- **Database**: PostgreSQL with Prisma ORM
- **Validation**: Zod
- **Logging**: Pino & Pino-Pretty
- **Test Framework**: Vitest
- **Telegram**: grammY

---

## 💻 Hardware & Memory Optimization (8 GB RAM)

PumpSentinel is tuned to run comfortably on an 8 GB RAM laptop alongside regular OS operations:

1. **Postgres Container**: Capped at `512 MB` memory in `docker-compose.yml` with `shared_buffers = 128MB` and `work_mem = 4MB`.
2. **In-Memory Cache**: `MAX_CACHE_TOKENS` defaults to `500` to prevent memory leaks from rapid token mint streams.
3. **HTTP Fetch Timeouts**: Metadata fetches enforce a 3-second `AbortSignal` timeout to prevent dangling connection leaks.
4. **Prisma Connection Pooling**: Pool size configured to `connection_limit=5` by default.

---

## 🛠️ Getting Started

### 1. Prerequisites

- Linux (Ubuntu recommended)
- Node.js >= 20
- Docker & Docker Compose

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/your-username/PumpSentinel.git
cd PumpSentinel

# Install dependencies
npm install

# Generate Prisma Client
npm run prisma:generate
```

### 3. Environment Configuration

Copy the example configuration:

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

- `DATABASE_URL`: PostgreSQL connection string (defaults to local docker-compose instance).
- `TELEGRAM_BOT_TOKEN`: Token obtained from [@BotFather](https://t.me/BotFather).
- `TELEGRAM_AUTHORIZED_USER_IDS`: Comma-separated list of Telegram user IDs authorized to issue commands.

> ⚠️ Never supply private keys! The application will immediately abort if any key named `PRIVATE_KEY` or `WALLET_KEY` is present.

### 4. Start PostgreSQL Database

```bash
docker compose up -d postgres
```

Verify that the container is healthy:

```bash
docker compose ps
```

### 5. Run Health Check

Run the built-in system health check CLI:

```bash
npm run healthcheck
```

Example output:

```
====================================================
       🛡️  PumpSentinel System Health Check
====================================================

[Status]       ✅ HEALTHY
[Timestamp]    2026-10-29T12:00:00.000Z
[Uptime]       0 seconds

--- Memory Utilization (Tuned for 8 GB RAM) ---
• Process RSS:     48.25 MB
• Heap Used:       18.42 MB / 25.10 MB
• OS Memory Used:  42.15% (Free: 4520.12 MB)
• Constrained:     ✅ NO

--- Subsystem Checks ---
✅ [DATABASE]: ok
    - connected: true
✅ [CONFIGURATION]: ok
    - nodeEnv: development
    - simulatedTradingOnly: true
    - initialBalanceSol: 10
    - maxCacheTokens: 500
```

### 6. Start Application

```bash
# Development mode with live reload
npm run dev

# Production build and run
npm run build
npm run start
```

---

## 📱 Telegram Commands

When interacting with your bot on Telegram:

| Command             | Description                                                              |
| :------------------ | :----------------------------------------------------------------------- |
| `/start`            | Bot welcome message, security guarantees, and quick start guide.         |
| `/help`             | Detailed listing of available commands and usage instructions.           |
| `/health`           | Live system health report (process RSS, system RAM, database status).    |
| `/status`           | Ingestion stream status, token discovery counter, and strategy settings. |
| `/portfolio`        | Paper portfolio balance, total realized & unrealized PnL, win/loss rate. |
| `/positions`        | List all open paper positions with current prices and ROI %.             |
| `/buy <mint> <sol>` | Execute a simulated paper BUY order.                                     |
| `/sell <mint>`      | Execute a simulated paper SELL order closing the position.               |
| `/risk <mint>`      | Run and view the risk engine evaluation for a token.                     |
| `/reset_portfolio`  | Reset paper trading balance to 10.0 SOL.                                 |

---

## 🧪 Quality Assurance & Scripts

```bash
# Type check TypeScript code
npm run typecheck

# Run linter
npm run lint

# Format code with Prettier
npm run format

# Run Vitest unit tests
npm run test
```

---

## 📄 License

MIT. Strictly for educational, monitoring, and simulated trading research.
