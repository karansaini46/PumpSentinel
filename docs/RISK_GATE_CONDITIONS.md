# PumpSentinel Central Risk-Decision Gate: Rejection Conditions & Invariants

## 1. Overview & Purpose

The **Central Risk-Decision Gate** (`RiskDecisionGate`) is the authoritative arbiter of token safety in PumpSentinel. It synthesizes findings from the `TokenAnalysisService`, `DeterministicRiskEngine`, and `WalletHistoryService` into a deterministic, explainable, and tamper-resistant eligibility decision.

Under PumpSentinel's zero-trust paper trading architecture, the gate establishes an absolute safety barrier before any strategy evaluation or simulated trade execution can occur.

---

## 2. Decision Outcomes

| Outcome | Passed? | Description | Can Strategy Trade? |
| :--- | :---: | :--- | :---: |
| `REJECT` | ❌ **No** | Token has failed one or more critical security criteria, lacks critical evidence, or has insufficient liquidity. The rejection is final for the current state and cannot be bypassed. | **Strictly Forbidden** |
| `NEEDS_RECHECK` | ❌ **No** | Evidence is stale, conflicting, or temporarily incomplete (e.g. unverified probabilistic bundle, recent material market shift). Token must be re-analyzed before eligibility can be determined. | **Strictly Forbidden** |
| `ELIGIBLE_FOR_STRATEGY` | ✅ **Yes** | Token has passed every critical check, meets all liquidity and distribution thresholds, and possesses complete, fresh, consistent evidence. | **Eligible** (if Strategy approves) |

---

## 3. Exhaustive Rejection Conditions (`REJECT`)

Any of the following conditions immediately triggers an outcome of **`REJECT`** with machine-readable reason codes and immutable evidence:

### 3.1 Insufficient Liquidity (`REJECT_INSUFFICIENT_LIQUIDITY`)
- **Initial/Pool Liquidity Below Minimum**: The token has less than `15.0 SOL` (configurable via `minLiquiditySol`) in initial or bonded liquidity.
- **Excessive Sell Price Impact**: The calculated price impact for selling 1.0 SOL of tokens exceeds `20.0%` (configurable via `maxSellPriceImpactPct`), indicating a shallow pool vulnerable to rug pulls or illiquidity traps.
- **Liquidity Check Status**: `checks.LIQUIDITY_AND_EXIT.status === 'FAIL'`.

### 3.2 Creator Supply Concentration (`REJECT_CREATOR_CONCENTRATION_EXCEEDED`)
- **Direct Holdings Above Limit**: The creator wallet holds more than `10.0%` (configurable via `creatorHoldingsThresholdPct`) of total or circulating token supply.
- **Multi-Account Aggregation**: When the creator controls multiple associated token accounts, their cumulative combined balance exceeds `10.0%`.
- **Creator Check Status**: `checks.CREATOR_CONCENTRATION.status === 'FAIL'`.

### 3.3 Top 10 Holder Concentration (`REJECT_TOP_HOLDERS_CONCENTRATION_EXCEEDED`)
- **Top 10 Supply Concentration Above Limit**: The top 10 non-bonding-curve holders control more than `30.0%` (configurable via `maxTop10ConcentrationPct`) of total supply.
- **Top Holders Check Status**: `checks.TOP_HOLDERS_CONCENTRATION.status === 'FAIL'`.

### 3.4 Suspected Bundled Purchases (`REJECT_BUNDLED_PURCHASES_EXCEEDED`)
- **Bundled Supply Above Limit**: Verified same-slot, same-block bundled purchases control more than `25.0%` (configurable via `suspectedBundleThresholdPct`) of token supply.
- **Sybil Cluster Concentration**: Early sniper wallets linked by transaction patterns or funding provenance own more than `25.0%` of supply.
- **Bundle Check Status**: `checks.BUNDLED_PURCHASES.status === 'FAIL'`.

### 3.5 Creator Malicious Behavior (`REJECT_CREATOR_SUSPICIOUS_BEHAVIOR`)
- **Rapid Dump**: Creator wallet sold or transferred more than 50% of their initial allocation within the first 5 minutes of launch.
- **Wash Trading**: High-velocity cyclic trades between creator-linked wallets detected.
- **Creator Behavior Check Status**: `checks.CREATOR_BEHAVIOR.status === 'FAIL'`.

### 3.6 Previous Harmful Launches (`REJECT_PREVIOUS_HARMFUL_LAUNCHES`)
- **Confirmed Rug Pull History**: Historical wallet analysis confirmed that the creator address previously deployed tokens that resulted in rug pulls, liquidity drainage, or honeypots.
- **Harmful Launches Check Status**: `checks.PREVIOUS_HARMFUL_LAUNCHES.status === 'FAIL'`.

### 3.7 Token Authorities Not Revoked (`REJECT_AUTHORITY_NOT_REVOKED`)
- **Mint Authority Active**: Token mint authority is not revoked (`requireRevokedMintAuthority: true`). An active mint authority allows the creator to mint unlimited new supply and crash the price.
- **Freeze Authority Active**: Token freeze authority is not revoked (`requireRevokedFreezeAuthority: true`). An active freeze authority allows the creator to freeze buyer accounts (honeypot).
- **Authorities Check Status**: `checks.TOKEN_AUTHORITIES.status === 'FAIL'`.

### 3.8 Missing Critical Risk Evidence (`REJECT_MISSING_CRITICAL_EVIDENCE`)
- **Insufficient Overall Completeness**: Overall data completeness score is below `75.0%` (configurable via `minDataCompletenessPct`).
- **Missing Creator Holdings**: Creator holdings data is completely unavailable or `UNKNOWN`.
- **Missing Liquidity/Reserves**: Pool reserves and liquidity depth are completely unavailable or `UNKNOWN`.
- **Missing Token Authorities**: Mint/freeze revocation state is `UNKNOWN`.
- **Data Completeness Check Status**: `checks.DATA_COMPLETENESS.status === 'FAIL'`.

### 3.9 Catastrophic Material Market Change (`REJECT_CATASTROPHIC_MARKET_CHANGE`)
- **Post-Evaluation Liquidity Collapse**: Market liquidity drops below `15.0 SOL` (e.g. from 30 SOL to 4 SOL) after initial evaluation.
- **Authority Revocation Breach**: An on-chain transaction attempts to assign or activate mint/freeze authorities.

---

## 4. Exhaustive Recheck Conditions (`NEEDS_RECHECK`)

Any of the following conditions sets the outcome to **`NEEDS_RECHECK`**, pausing strategy evaluation until fresh data is collected:

### 4.1 Stale Critical Data (`RECHECK_STALE_CRITICAL_DATA`)
- **Analysis Report Age Exceeded**: Observation timestamp is older than `60,000 ms` (configurable via `maxDataAgeMs`).
- **Provider Flagged Stale**: Any critical field (`liquiditySol`, `creatorHoldings`, `largestHolders`, `authorities`) has `dataFreshness: 'STALE'`.
- **Decision TTL Exceeded**: Cached gate decision has exceeded its TTL (`300,000 ms`).

### 4.2 Conflicting Evidence (`RECHECK_CONFLICTING_EVIDENCE`)
- **Liquidity vs. Reserves Discrepancy**: Reported liquidity is $\ge 15\text{ SOL}$, but pool reserves show $0\text{ SOL}$, or reported liquidity differs from on-chain reserves by $> 60\%$.
- **Mathematical Impossibility**: Creator percentage + Top 10 percentage exceeds $105\%$, or any individual holder exceeds $100\%$ of supply.
- **Authority Status Contradiction**: Mint/freeze authority is flagged as revoked, yet an active valid public key is present.
- **Raw Holder Discrepancy**: Aggregated raw holder accounts differ from provider reported creator holdings by $> 15\%$.

### 4.3 Material Market Changes (`RECHECK_MATERIAL_MARKET_CHANGE`)
- **Material Liquidity Drop**: Liquidity drops by $\ge 10.0\%$ (configurable via `materialLiquidityDropPct`) from initial evaluation, while remaining above `15.0 SOL`.
- **Large Sell Dump**: A single sell or clustered sells exceeding $\ge 5.0\%$ of supply or liquidity occur.
- **Holder Concentration Spike**: Significant accumulation by top holders detected post-launch.

### 4.4 Unconfirmed Probabilistic Bundles (`RECHECK_PROBABILISTIC_BUNDLE_UNCONFIRMED`)
- When `allowProbabilisticBundles: false` and `checks.BUNDLED_PURCHASES.status === 'WARN'` (suspected bundle based on timing heuristics but pending on-chain signature graph verification).

### 4.5 Price/Volume Anomalies (`RECHECK_PRICE_VOLUME_ANOMALY`)
- When `checks.PRICE_AND_VOLUME.status === 'WARN'`, indicating abnormal wash volume or extreme 1-minute price volatility.

---

## 5. The Ten Risk Gate Rules

1. **Rule 1 (Critical FAIL)**: Any critical category failure (`status === 'FAIL'`) immediately rejects the token.
2. **Rule 2 (Missing Evidence)**: Missing critical evidence prevents eligibility (`REJECT_MISSING_CRITICAL_EVIDENCE`).
3. **Rule 3 (Stale Data)**: Stale critical data triggers rechecking (`RECHECK_STALE_CRITICAL_DATA`).
4. **Rule 4 (Insufficient Liquidity)**: Insufficient liquidity (< 15 SOL) rejects the token (`REJECT_INSUFFICIENT_LIQUIDITY`).
5. **Rule 5 (Conflicting Evidence)**: Conflicting or contradictory evidence triggers rechecking (`RECHECK_CONFLICTING_EVIDENCE`).
6. **Rule 6 (Evidence Audit)**: Every decision records its reasons, reason codes, metric snapshots, and timestamps.
7. **Rule 7 (Strategy Cannot Override)**: The strategy cannot override a risk rejection. Rejections and rechecks force strategy signal to `HOLD`.
8. **Rule 8 (Configurable Thresholds)**: All risk thresholds are configurable and support runtime adjustment.
9. **Rule 9 (Versioned Decisions)**: Decisions are versioned (`decisionVersion: '1.0.0'`) and maintained in a historical audit buffer per mint.
10. **Rule 10 (Material Market Re-evaluation)**: Market changes ($\ge 10\%$ liquidity drops, dumps) immediately invalidate active eligibility and trigger re-evaluation.

---

## 6. The Final Invariant

> **INVARIANT GUARANTEE**:
> **No token can be purchased by the paper-trading engine unless it has passed the required risk gate and the entry strategy.**

### Enforcement Mechanics:
In `PaperExecutionEngine.executeSimulatedOrder(request)`:
1. For every simulated order where `side === 'BUY'`:
   - Validates that a `RiskGateDecision` exists for the token mint.
   - Verifies that `decision.outcome === 'ELIGIBLE_FOR_STRATEGY'`.
   - Verifies that `decision.passed === true`.
   - Verifies that `decision.isExpired === false` and `Date.now() <= decision.expiresAt.getTime()`.
   - Verifies that `request.strategySignal` exists and has `action === 'BUY'`.
2. Any violation throws a fatal `RiskGateInvariantViolationError` and halts trade execution.
3. Live private keys and live trade signing remain strictly disabled.

---

## 7. Configurable Thresholds Reference

| Parameter | Default | Unit | Description |
| :--- | :---: | :---: | :--- |
| `creatorHoldingsThresholdPct` | `10.0` | `%` | Max allowable creator token supply |
| `suspectedBundleThresholdPct` | `25.0` | `%` | Max allowable bundled purchase supply |
| `minLiquiditySol` | `15.0` | `SOL` | Minimum required liquidity depth |
| `maxTop10ConcentrationPct` | `30.0` | `%` | Max allowable top 10 holder supply |
| `maxSellPriceImpactPct` | `20.0` | `%` | Max allowable price impact for 1 SOL sell |
| `requireRevokedMintAuthority` | `true` | `bool` | Must be revoked |
| `requireRevokedFreezeAuthority` | `true` | `bool` | Must be revoked |
| `minDataCompletenessPct` | `75.0` | `%` | Minimum required data completeness |
| `maxDataAgeMs` | `60,000` | `ms` | Maximum data age before marked stale |
| `decisionTtlMs` | `300,000` | `ms` | Validity duration of gate decision |
| `materialLiquidityDropPct` | `10.0` | `%` | Liquidity drop triggering re-evaluation |
| `materialLargeSellPct` | `5.0` | `%` | Dump percentage triggering re-evaluation |
| `allowProbabilisticBundles` | `false` | `bool` | Whether to pass unconfirmed bundles |
