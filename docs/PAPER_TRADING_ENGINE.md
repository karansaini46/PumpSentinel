# PumpSentinel Paper-Trading Engine Specification

## 1. Executive Summary & Security Invariants

The PumpSentinel Paper-Trading Engine provides a realistic, deterministic, and safe simulation environment for algorithmic trading on Solana bonding curves (such as pump.fun and Raydium).

### Strict Safety & Simulation Invariants
1. **Never Create or Sign Real Transactions**: The engine contains zero wallet signing logic, zero Solana transaction construction for real mainnet funds, and operates entirely in simulated virtual accounting. Every trade execution record is explicitly marked `isSimulated: true`.
2. **Never Request a Wallet Private Key**: The application actively scans its environment and constructor parameters for forbidden secrets (`PRIVATE_KEY`, `WALLET_KEY`, `WALLET_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY`, `MNEMONIC`, `SEED_PHRASE`). If any private key is detected, the engine aborts immediately with a fatal error.
3. **Risk Gate Pre-Condition Invariant**: By architectural invariant, no token can be purchased by the paper-trading engine unless it has passed the deterministic Central Risk-Decision Gate with outcome `ELIGIBLE_FOR_STRATEGY` and received a valid `BUY` signal from the entry strategy.

---

## 2. Virtual Portfolio Configuration

The virtual portfolio is initialized with experimental parameters designed for micro-cap meme token analysis:

| Configuration Parameter | Default Value | Description |
| :--- | :--- | :--- |
| **Starting Balance** | **$800.00** (5.0000 SOL @ $160/SOL) | Initial virtual portfolio cash capital |
| **Default Position Size** | **$20.00** (0.1250 SOL @ $160/SOL) | Standard allocation per new position |
| **Max Concurrent Positions** | **5** | Maximum simultaneous open positions |
| **Take-Profit Target (TP)** | **+50.0%** | Configurable target profit exit trigger |
| **Stop-Loss Threshold (SL)**| **-20.0%** | Configurable loss mitigation exit trigger |
| **Max Holding Time** | **3,600,000 ms (1 hour)** | Configurable timeout before time-based exit |
| **Reference SOL/USD Rate** | **$160.00** | Dual-currency real-time accounting conversion |

> **Disclaimer**: These configuration values represent experimental parameters for software testing and simulated research, not financial or investment advice.

### Dual-Currency Accounting
All positions, orders, fills, and portfolio summaries maintain synchronized dual-currency ledger entries:
- **SOL Ledger**: Direct accounting of Solana on-chain values, bonding curve reserves, and network/swap fees.
- **USD Ledger**: Reference accounting reflecting portfolio valuation, cost basis, realized P&L, and unrealized P&L in USD.

---

## 3. Realistic Market Execution Simulation

Real decentralized exchange (DEX) trading experiences slippage, market impact, network priority fees, and liquidity constraints. PumpSentinel models these mechanics accurately.

### A. Constant Product AMM Price Impact
In constant product bonding curves ($x \cdot y = k$), trade volume relative to pool reserves alters the marginal exchange rate.

Given:
- $\Delta x$: Trade volume in SOL (for BUY) or token nominal SOL value (for SELL)
- $x_{\text{pool}}$: Total pool SOL liquidity reserve (e.g., bonding curve reserve, typically 30 SOL)

The simulated price impact percentage is calculated as:
$$\text{priceImpactPct} = \left( \frac{\Delta x}{x_{\text{pool}} + \Delta x} \right) \times 100$$

### B. Executed Price Derivation
The simulated executed price accounts for both price impact and market slippage:

- **Simulated BUY**:
  $$\text{executedPriceSol} = \text{basePriceSol} \times \left(1 + \frac{\text{priceImpactPct}}{100}\right) \times \left(1 + \frac{\text{slippageBps}}{10000}\right)$$

- **Simulated SELL**:
  $$\text{executedPriceSol} = \text{basePriceSol} \times \left(1 - \frac{\text{priceImpactPct}}{100}\right) \times \left(1 - \frac{\text{slippageBps}}{10000}\right)$$

If adverse slippage and price impact would result in a non-positive execution price, the fill is rejected immediately.

### C. Simulated Fee Model
Every simulated transaction accounts for two realistic fee components:
1. **Solana Network Fee**: Default `0.005 SOL` per transaction (models base signature fee plus priority micro-lamports for fast inclusion).
2. **Protocol / DEX Swap Fee**: Default `1.0%` (100 bps) of gross trade volume.

$$\text{simulatedFeeSol} = \text{networkFeeSol} + (\text{totalSol} \times 0.01)$$

---

## 4. Rejection of Unrealistic Fills

Simulated trades that could not execute in real market conditions are rejected deterministically with `UnrealisticExecutionError`:

| Rejection Condition | Threshold | Reason Code |
| :--- | :--- | :--- |
| **Insufficient Pool Liquidity** | Pool liquidity $< 15.0$ SOL | `INSUFFICIENT_POOL_LIQUIDITY` |
| **Excessive Order Capacity** | Order size $> 25\%$ of pool liquidity | `ORDER_EXCEEDS_POOL_CAPACITY` |
| **Excessive Price Impact** | Calculated price impact $> 35.0\%$ | `EXCESSIVE_PRICE_IMPACT` |
| **Non-Positive Price** | Executed price $\le 0$ SOL | `NON_POSITIVE_PRICE` |

---

## 5. Partial Fill Policy & Approximation

Real AMM pools may only partially fill large orders without causing catastrophic price slippage. PumpSentinel implements an **80% Minimum Fill-or-Kill** approximation:

1. **Threshold**: The minimum acceptable fill ratio is **80%** (`minFillRatio = 0.80`).
2. **Partial Fill Execution**: If pool capacity or price impact limits the fillable volume, but the achievable fill is $\ge 80\%$ of requested size:
   - The fillable tranche is executed.
   - `isPartialFill` is set to `true`.
   - `fillRatio`, `amountTokens`, `totalSol`, `unfilledTokens`, and `unfilledSol` are explicitly recorded.
   - Unfilled cash remains in the portfolio cash balance.
3. **Rejection**: If the achievable fill is $< 80\%$ of the requested order, the entire order is rejected with `ORDER_EXCEEDS_POOL_CAPACITY` or `EXCESSIVE_PRICE_IMPACT`.

---

## 6. Timestamp Integrity & Anti-Lookahead Guarantees

### A. Anti-Lookahead Bias Protection (Requirement 12)
To guarantee backtest and simulation validity:
- **No Future Market Data**: If `quote.observedAt > evaluationTimestamp + 100ms`, the engine throws `FutureMarketDataError`.
- It is strictly impossible to use future price discovery to retroactively calculate past fills.

### B. Staleness and Missing Price Rejection
- **No Invented Prices**: If market data is unavailable, non-positive ($\le 0$), or marked stale, the engine throws `StaleMarketDataError`.
- **Max Data Age**: If quote age $(t_{\text{eval}} - t_{\text{quote}}) > 60,000\text{ ms}$ (60 seconds), the quote is rejected as stale.

---

## 7. Portfolio Management & Operational Controls

### A. Duplicate Prevention (Requirement 7)
- **Duplicate Fills**: Each trade possesses a unique `tradeId`. Any attempt to re-record an already processed fill throws `DuplicateFillError`.
- **Duplicate Positions**: The portfolio enforces a strict one-active-position-per-mint invariant. Attempting to open a second position for an existing token throws `DuplicatePositionError`.

### B. Concurrency Limit
- If open positions count reaches **5**, any new BUY order is rejected with `MaxPositionsExceededError`.

### C. Separate Realized and Unrealized P&L (Requirement 8)
- **Realized P&L**: Updated exclusively upon position closure or partial sale, net of all simulated entry and exit fees.
- **Unrealized P&L**: Continuously tracked per position based on active market quotes:
  $$\text{unrealizedPnlSol} = (\text{amountTokens} \times \text{currentPriceSol}) - \text{solInvested}$$

### D. Order Cancellation & Emergency Liquidations (Requirement 11)
- **Order Cancellation**: Pending orders registered via `registerPendingOrder` can be cancelled prior to execution using `cancelOrder(clientOrderId)`.
- **Emergency Single Closure**: `emergencyClosePosition(mint, quote, reason)` immediately executes a simulated SELL at current market rates, accounting for price impact and fees, and marks the position as `EMERGENCY_CLOSED`.
- **Emergency Global Liquidation**: `emergencyCloseAllPositions(quotesMap, reason)` closes all open positions across the portfolio (e.g., during sudden market-wide volatility).

---

## 8. Post-Restart Cash Ledger Reconciliation (Requirement 9)

In the event of an ungraceful crash, network disconnection, or process restart, `portfolio.reconcile()` rebuilds and audits the entire state from persistent ledger logs:

$$\text{Reconciled Cash SOL} = \text{Initial SOL} - \sum_{\text{BUYs}} (\text{Sol Amount} + \text{Fee}) + \sum_{\text{SELLs}} (\text{Sol Amount} - \text{Fee})$$

The reconciliation process:
1. Replays all persistent `PaperTrade` records.
2. Recalculates exact cumulative cash flows and fees paid.
3. Reconstructs all open `PaperPosition` records from remaining token inventories.
4. Audits the recorded cash balance against the mathematical ledger truth.
5. Emits a comprehensive `ReconciliationReport` detailing reconciled cash, active positions, discrepancy (if any), and audit notes.

---

## 9. Simulation Limitations

While PumpSentinel provides high-fidelity execution simulation, users should consider the following market limitations:

1. **Adverse Selection & MEV**: In live mainnet conditions, large transactions on public bonding curves are vulnerable to MEV sandwich attacks and front-running by searcher bots. The simulation accounts for constant-product price impact and slippage, but does not simulate malicious bundle sandwiching.
2. **Network Congestion Volatility**: Solana priority fees can spike dramatically during periods of extreme network congestion. The default simulated network fee (0.005 SOL) represents a standard priority fee.
3. **Discrete vs. Continuous Order Depth**: The simulation models constant product pools with uniform liquidity depth; in reality, discrete tick-based liquidity pools (e.g. Raydium CLMM) may exhibit non-linear slippage curves.
