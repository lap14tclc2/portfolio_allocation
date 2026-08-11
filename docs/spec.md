# IPDPS v4 — System Specification

> **IP-DPS**: Investment Portfolio Decision & Planning System  
> **Version**: 4 (Server-Side Rendered)  
> **Architecture**: Node.js HTTP server + vanilla JS client  
> **Currency**: VND (Vietnamese Dong)

---

## 1. Purpose

IPDPS v4 is a personal portfolio management system that implements:

1. **Equal Risk Contribution (ERC)** allocation — annual target weights where each asset contributes equally to portfolio risk.
2. **Shannon Rebalancing** — drift-band detection with buy/sell recommendations to restore ERC targets.
3. **3-Layer Architecture** — separation of policy, state, and proposed changes.

The system answers three questions at any point in time:
- **What should my portfolio be?** → Locked Annual ERC Allocation
- **What do I actually own?** → Portfolio State
- **What changes am I considering?** → Suggestions

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│         LAYER 1: ANNUAL ERC ALLOCATION          │
│                                                 │
│  🔒 Locked target weights (immutable per year)  │
│  Risk window, ERC diagnostics                   │
│  File: data/annual-target.json                  │
└────────────────────────┬────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────┐
│         LAYER 2: PORTFOLIO STATE                │
│                                                 │
│  Actual holdings (shares, prices, values)       │
│  Cash reserve, NAV, weights                     │
│  File: data/portfolio-state.json                │
└────────────────────────┬────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
┌───────────────────────┐ ┌────────────────────────┐
│   SHANNON ENGINE      │ │   USER EVENTS          │
│                       │ │                        │
│   Drift analysis      │ │   SELL_ALL             │
│   Band detection      │ │   ADD_TICKER           │
│   Hard Bank funding   │ │   REMOVE_TICKER        │
│   Trade suggestions   │ │   ADD_CAPITAL          │
└───────────┬───────────┘ │   WITHDRAW             │
            │             │   BUY / SELL            │
            │             └────────────┬───────────┘
            └───────────┬──────────────┘
                        ▼
┌─────────────────────────────────────────────────┐
│         LAYER 3: SUGGESTIONS                    │
│                                                 │
│  📝 Proposed changes (staging area)             │
│  Source: Shannon | User                         │
│  Status: PENDING → APPROVED/REJECTED            │
│  Universe change detection + warnings           │
│  File: data/suggestions.json                    │
└────────────────────────┬────────────────────────┘
                         │
                   User APPROVES
                         │
                         ▼
                  EXECUTION
                         │
                         ▼
              Updated Portfolio State
```

---

## 3. Core Invariant

> **The Locked Allocation table is immutable during the allocation year. All user-initiated changes and system-generated trades first appear as suggestions. Only an approved event changes Portfolio State. A change to the investment universe triggers a warning rather than silently modifying the locked allocation.**

---

## 4. Layer Details

### 4.1 Layer 1 — Annual ERC Allocation (`data/annual-target.json`)

| Field | Description |
|-------|-------------|
| `year` | Allocation year (e.g. 2026) |
| `allocationDate` | Effective date (`YYYY-01-01`) |
| `riskWindow` | `{start, end}` — lookback period for covariance (5 years) |
| `method` | Always `"ERC"` |
| `targets` | `{ticker: weight}` — ERC-optimal weights summing to 1.0 |
| `locked` | `true` — cannot be modified during the year |
| `createdAt` | ISO timestamp |
| `diagnostics` | Validation metrics (observations, risk, variance, error) |

**Behavior:**
- Calculated once per year on first `/api/analyze` call.
- If a locked target exists for the current year, it is reused — never recalculated.
- Manual override via `/api/annual-reset` (force recalculation).
- The ERC solver iterates up to 10,000 times until each asset's risk contribution equals `1/N` (tolerance: 1e-7).

### 4.2 Layer 2 — Portfolio State (`data/portfolio-state.json`)

| Field | Description |
|-------|-------------|
| `updatedAt` | ISO timestamp of last state update |
| `totalNav` | Total portfolio value (equity + cash) |
| `equityNav` | Sum of all stock market values |
| `cashReserve` | Cash held outside equities |
| `holdings[]` | Array of `{ticker, shares, price, averageCost, marketValue, weight}` |

**Behavior:**
- Updated automatically after every `/api/analyze` call.
- Represents **what you actually own** — not what you should own.
- Weight = `marketValue / totalNav` (includes cash in denominator).

### 4.3 Layer 3 — Suggestions (`data/suggestions.json`)

| Field | Description |
|-------|-------------|
| `updatedAt` | ISO timestamp |
| `suggestions[]` | Array of suggestion objects |

Each suggestion:

| Field | Description |
|-------|-------------|
| `id` | Unique ID (`s_<timestamp>_<random>`) |
| `event` | `REBALANCE`, `SELL_ALL`, `ADD_TICKER`, `REMOVE_TICKER`, `ADD_CAPITAL`, `WITHDRAW`, `BUY`, `SELL` |
| `ticker` | Affected ticker (null for cash events) |
| `currentShares` | Shares before trade |
| `proposedShares` | Shares after trade |
| `tradeShares` | Number of shares to trade |
| `tradeAmount` | VND value of trade |
| `action` | `BUY` / `SELL` / `OTHER` |
| `band` | Drift band (Shannon suggestions only) |
| `drift` | Drift from ERC target (Shannon suggestions only) |
| `impact` | `Universe addition` / `Universe removal` / `NAV change` / `None` |
| `source` | `Shannon` or `User` |
| `status` | `PENDING` → `APPROVED` or `REJECTED` |
| `createdAt` | ISO timestamp |

**Behavior:**
- Shannon suggestions are regenerated on every `/api/analyze` (old pending Shannon entries are replaced).
- User events accumulate and persist until approved/rejected.
- Universe-change events trigger a warning: *"ERC recalculation required at next annual allocation."*
- Nothing executes until explicitly approved.

---

## 5. ERC Engine (`core/erc.js`)

### Algorithm

1. **Risk Window**: 5-year lookback ending December 31 of prior year.
2. **Data Preparation**: Filter histories to risk window, intersect dates across all tickers.
3. **Returns**: Log returns `ln(P_t / P_{t-1})`.
4. **Covariance Matrix**: Sample covariance of daily log returns, annualized (×252).
5. **Symmetry Validation**: Verifies `cov[i][j] == cov[j][i]` within 1e-10.
6. **ERC Optimization**: Iterative solver (up to 10,000 iterations):
   - Start with equal weights `1/N`.
   - Adjust weights so each asset's risk contribution → `1/N` of total.
   - Convergence criterion: max absolute RC deviation < 1e-7.
7. **Validation**: Final `ercError` must be < 1e-5.

### Outputs

- `weights[]` — ERC-optimal weight per asset
- `volatility[]` — annualized volatility per asset
- `riskContributions[]` — relative risk contribution per asset (should all ≈ 1/N)
- `portfolioRisk` — portfolio-level annualized volatility
- `diagnostics` — validation metadata

---

## 6. Shannon Rebalancing (`core/portfolio.js`)

### Drift Bands

Relative bands around ERC target weight:

| Band | Range | Action |
|------|-------|--------|
| NORMAL | target ± 10% | HOLD |
| SOFT | target ± 10–20% | BUY/SELL (rebalance) |
| HARD | beyond ± 20% | BUY/SELL (urgent rebalance) |

Example: If ERC target = 35%, normal band = 31.5%–38.5%, soft band = 28%–42%.

### Hard Bank Funding Model

1. Calculate target trade amount for each asset (difference between target value and current value).
2. Total sell proceeds fund total buy requirements.
3. Cash reserve supplements if sells are insufficient.
4. If total buy > available funding (sells + cash), buys are scaled proportionally.
5. Sells always execute fully.

### Outputs per Asset

- `value` — current market value
- `currentWeight` — actual weight in portfolio
- `ercWeight` — locked annual target weight
- `drift` — currentWeight − ercWeight
- `band` — NORMAL / SOFT / HARD
- `recommendation` — HOLD / BUY / SELL
- `targetTradeAmount` — ideal trade in VND
- `fundedTradeAmount` — actual funded trade (after hard bank)
- `sharesToTrade` — fractional shares
- `expectedWeight` — projected weight after trade

---

## 7. Data Layer (`core/storage.js`)

File-based JSON persistence:

| Function | File | Purpose |
|----------|------|---------|
| `readAnnualTarget` / `writeAnnualTarget` | `data/annual-target.json` | Locked ERC allocation |
| `readPortfolioState` / `writePortfolioState` | `data/portfolio-state.json` | Current holdings |
| `readSuggestions` / `writeSuggestions` | `data/suggestions.json` | Proposed changes |
| `readBacklog` / `writeBacklog` | `backlog.txt` | Snapshot of stock inputs |
| `readHistory` / `writeHistory` | `data/<TICKER>.csv` | Price history per ticker |
| `writeOutput` | `output.json` | Last analysis result |

---

## 8. API Reference

### Existing Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve `index.html` |
| GET | `/client/*` | Serve client assets (JS, CSS) |
| GET | `/api/backlog` | Load latest stock snapshot |
| POST | `/api/sync` | Save stock snapshot to backlog |
| GET | `/api/history/:ticker` | Read price history CSV |
| POST | `/api/history/:ticker` | Upload price history CSV |
| POST | `/api/analyze` | Run full analysis (ERC + Shannon + update state + generate suggestions) |
| GET | `/api/annual-target` | Read locked annual ERC target |
| POST | `/api/annual-reset` | Force ERC recalculation (override lock) |

### New Endpoints (3-Layer Architecture)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/portfolio-state` | Current portfolio holdings and NAV |
| GET | `/api/suggestions` | All suggestions + universe change warning |
| POST | `/api/suggestions` | Create user event `{event, ticker, details}` |
| POST | `/api/suggestions/approve` | Approve suggestion by `{id}` |
| POST | `/api/suggestions/reject` | Reject suggestion by `{id}` |

---

## 9. Server (`server.js`)

- Pure Node.js `http.createServer` (no framework).
- Port: `process.env.PORT` or 3000.
- Request logging with duration.
- Graceful shutdown on SIGINT/SIGTERM (5s timeout).
- All errors caught and returned as JSON `{error: message}` with status 400.

---

## 10. Client (`client/`)

Vanilla JavaScript (ES modules, no build step):

| File | Purpose |
|------|---------|
| `main.js` | Orchestrates UI: sync backlog, run analysis, upload history |
| `api.js` | Fetch wrappers for all API calls |
| `ui.js` | DOM manipulation, table rendering, formatting |
| `style.css` | Styling |

### UI Sections

1. **Stock Input Table** — ticker, average cost, shares, current price, history upload
2. **Cash Reserve Input** — VND amount
3. **History Validation** — per-ticker PASS/FAIL/MISSING status
4. **ERC Annual Allocation** — year, status, risk window, observations, portfolio risk, per-asset weights
5. **Shannon Rebalancing** — funding summary (NAV, cash, hard bank) + per-asset drift/band/recommendation/trade

---

## 11. File Structure

```
v4/
├── server.js                    # HTTP server entry point
├── index.html                   # Single-page client
├── backlog.txt                  # Latest stock snapshot
├── output.json                  # Last analysis output
├── client/
│   ├── main.js                  # Client orchestration
│   ├── api.js                   # API fetch wrappers
│   ├── ui.js                    # DOM rendering
│   └── style.css                # Styles
├── core/
│   ├── config.js                # Paths, ports, ERC params, band thresholds
│   ├── erc.js                   # ERC optimization engine
│   ├── history.js               # CSV parser for price histories
│   ├── portfolio.js             # Shannon rebalancing + band classification
│   ├── portfolio-state.js       # Layer 2: actual holdings state
│   ├── suggestions.js           # Layer 3: suggestion staging + user events
│   ├── storage.js               # File I/O (JSON + CSV + text)
│   ├── routes.js                # HTTP route handler (all API logic)
│   ├── backlog.js               # Backlog text parser
│   └── logger.js                # Timestamped console logger
├── data/
│   ├── annual-target.json       # 🔒 Layer 1: locked ERC allocation
│   ├── portfolio-state.json     # 📊 Layer 2: current holdings
│   ├── suggestions.json         # 📝 Layer 3: proposed changes
│   ├── ACB.csv                  # Price history
│   ├── DGC.csv                  # Price history
│   └── FPT.csv                  # Price history
└── docs/
    └── spec.md                  # This file
```

---

## 12. Current Portfolio (as of 2026-08-10)

### Locked ERC Allocation (2026)

| Ticker | Target Weight | Risk Contribution |
|--------|-------------:|------------------:|
| ACB | 39.42% | 33.33% |
| DGC | 24.82% | 33.33% |
| FPT | 35.76% | 33.33% |

- Portfolio Risk: 23.96% (annualized)
- Risk Window: 2021-01-01 → 2025-12-31
- Observations: 1,066

### Holdings

| Ticker | Shares | Price (VND) | Market Value | Weight |
|--------|-------:|------------:|-------------:|-------:|
| ACB | 19,210 | 22,400 | 430,304,000 | ~38.95% |
| DGC | 10,000 | 44,200 | 442,000,000 | ~40.01% |
| FPT | 3,000 | 70,800 | 212,400,000 | ~19.23% |
| Cash | — | — | 20,000,000 | ~1.81% |

**Total NAV**: ~1,104,704,000 VND

---

## 13. Configuration (`core/config.js`)

| Parameter | Value | Description |
|-----------|-------|-------------|
| `erc.annualizationFactor` | 252 | Trading days per year |
| `erc.minimumObservations` | 60 | Minimum data points required |
| `erc.lookbackYears` | 5 | Years of history for covariance |
| `bands.normal` | 0.10 (10%) | Relative band for HOLD zone |
| `bands.soft` | 0.20 (20%) | Relative band for SOFT rebalance |

---

## 14. Workflow

### Standard Analysis Flow

```
User clicks "Analyze"
    │
    ▼
POST /api/analyze {stocks, cashReserve}
    │
    ├─ Resolve annual target (load locked or calculate + lock)
    ├─ Calculate ERC (if new)
    ├─ Build portfolio: drift → bands → recommendations → hard bank
    ├─ Update Portfolio State (Layer 2)
    ├─ Generate Shannon Suggestions (Layer 3)
    ├─ Save output.json + backlog.txt
    │
    ▼
Return full analysis result to client
```

### User Event Flow

```
User submits event (e.g., SELL_ALL DGC)
    │
    ▼
POST /api/suggestions {event: "SELL_ALL", ticker: "DGC"}
    │
    ▼
Suggestion created with status: PENDING
    │
    ▼
GET /api/suggestions → shows universe change warning
    │
    ▼
POST /api/suggestions/approve {id}
    │
    ▼
Suggestion status → APPROVED
(Execution is manual — user updates shares and re-runs analysis)
```

---

## 15. Future Phases

### Phase 2 — Prospective ERC
- Automatic universe-change detection triggers prospective ERC calculation.
- "What-if" analysis before approving universe changes.
- New ERC targets computed but NOT locked until annual reset.

### Phase 3 — Event Ledger
- Full transaction history (executed trades, dividends, corporate actions).
- Historical portfolio reconstruction.
- Tax-lot tracking and transaction cost modeling.
