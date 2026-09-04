# Trading Terminal

An AI-assisted trading analysis platform built on OmniRoute's existing
infrastructure. It computes explainable trading signals, sizes positions against
configured risk limits, and gates every trade behind a mandatory risk engine.

> **What this is not.** It does not predict prices, does not guarantee outcomes,
> and does not ship with any market-data vendor. It is a decision-support and
> risk-control system. `NO TRADE` and `WAIT` are first-class outputs.

---

## 1. Design rules

Four rules shape every module. They are enforced by types and tests, not by
convention:

| Rule                             | How it is enforced                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No fabricated data               | Every market value carries `Provenance` (`source`, `timestamp`, `status`). Provider methods return `Availability<T>`, so "we don't know" is representable. The provider registry ships **empty**. |
| Stale data cannot drive a signal | `freshness.ts` is the single gate. A `LIVE` stamp past its budget degrades to `STALE`; the orchestrator refuses a tradeable verdict without it.                                                   |
| Every score is explainable       | `SignalResult.factors` carries a `ScoreFactor` per component with cited `evidence`. There is no code path emitting a score without factors.                                                       |
| Risk cannot be bypassed          | `analyzeInstrument()` runs the risk engine last and produces the verdict itself. Callers cannot assemble a **TRADEABLE** result.                                                                  |

### Data status

`DataStatus` is never inferred and never upgraded:

- `LIVE` — real-time, inside the freshness window
- `DELAYED` — real provider data, knowingly behind
- `HISTORICAL` — closed/settled bars
- `PAPER` — simulated execution against real data
- `SIMULATED` — synthetic (backtests, fixtures)
- `STALE` — was `LIVE`, exceeded its budget
- `UNAVAILABLE` — no data; the UI shows `DATA SOURCE UNAVAILABLE`

Only `LIVE` and `DELAYED` permit live signal generation
(`TRADEABLE_DATA_STATUSES` in `src/lib/trading/types.ts`).

---

## 2. Pipeline

```
providers → freshness gate → indicators → structure → MTF → regime
  → signal → levels → sizing → RISK ENGINE → verdict
```

Entry point: `analyzeInstrument()` in `src/lib/trading/analysisService.ts`.

The order is the safety property. The risk engine is last and can veto
everything above it. Its four possible verdicts:

| Verdict              | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| **TRADEABLE**        | Every check passed, the signal cleared its threshold, and a valid size exists |
| **NO_TRADE**         | Data is fine; the setup is not good enough                                    |
| **BLOCKED**          | A critical risk check failed                                                  |
| **DATA_UNAVAILABLE** | Data is missing or stale — nothing below is actionable                        |

---

## 3. Module map

| Module                               | Purpose                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/lib/trading/types.ts`           | Domain types; provenance is mandatory                                                                   |
| `src/lib/trading/freshness.ts`       | Staleness gate, series integrity, candle normalisation                                                  |
| `src/lib/trading/providers/`         | Adapter contracts + registry (`MarketData`, `News`, `Fundamental`, `EconomicCalendar`, `Broker`)        |
| `src/lib/trading/indicators/`        | SMA/EMA/WMA, RSI, MACD, Bollinger, ATR, ADX, Stochastic, CCI, ROC, OBV, VWAP, Volume Profile, Fibonacci |
| `src/lib/trading/structure.ts`       | Swings, HH/HL/LH/LL, trend, S/R, breakout/fakeout/BOS/CHoCH                                             |
| `src/lib/trading/mtf.ts`             | Multi-timeframe reading and conflict detection                                                          |
| `src/lib/trading/regime.ts`          | Regime detection → factor weights + risk multiplier                                                     |
| `src/lib/trading/signal.ts`          | Regime-weighted scoring, Trade Quality Score, explanation                                               |
| `src/lib/trading/entry.ts`           | Entry zone, invalidation, stop, TP1–TP3                                                                 |
| `src/lib/trading/positionSizing.ts`  | Size from risk budget, caps and costs                                                                   |
| `src/lib/trading/riskEngine.ts`      | 13 pre-trade checks + the live-order gate                                                               |
| `src/lib/trading/backtest.ts`        | Look-ahead-free backtester                                                                              |
| `src/lib/trading/paperTrading.ts`    | Simulated execution on real data                                                                        |
| `src/lib/trading/portfolio.ts`       | Correlation, concentration, journal statistics                                                          |
| `src/lib/trading/copilot.ts`         | Evidence packet + system prompt + output audit                                                          |
| `src/lib/trading/analysisService.ts` | The orchestrator                                                                                        |
| `src/lib/db/trading.ts`              | Persistence (migration 171)                                                                             |

---

## 4. Correctness notes worth knowing

These are the places where a plausible-looking implementation is wrong:

- **Wilder smoothing is not an EMA.** RSI, ATR and ADX use a `1/n` multiplier,
  not `2/(n+1)`. `wilderSmooth()` is deliberately separate from `ema()`;
  conflating them is the usual cause of readings that disagree with every other
  platform.
- **MACD's signal line** is seeded from the first bar where the MACD line
  exists. Seeding at index 0 with nulls coerced to zero shifts every crossover.
- **Bollinger Bands use the population standard deviation** (÷N). The sample
  deviation (÷N−1) draws visibly wider bands.
- **CCI uses mean absolute deviation**, not standard deviation. The two differ
  by roughly 20%, and only the former makes ±100 meaningful.
- **VWAP is session-anchored.** A running total from the first row in the
  database is not the VWAP anyone is looking at.
- **Volume profile spreads each bar's volume across the bins its range covers**,
  proportional to overlap — not into its close bin.
- **Swings require a confirmed right side.** The newest `lookback` bars can never
  produce a swing. That lag is real and is preserved; reporting a swing earlier
  is look-ahead bias.
- **An uptrend requires both higher highs and higher lows.** Higher highs with
  lower lows is a broadening formation.
- **Relative volume excludes the current bar** from its own baseline.
- **Position sizes round down.** Rounding up pushes risk past the configured
  limit.
- **Maximum loss includes fees and slippage.** A size that risks exactly 1%
  before costs risks more than 1% in reality.
- **Profit factor is `null`, not `Infinity`,** when nothing was lost — `Infinity`
  reads as a spectacular result rather than as insufficient data.

---

## 5. Backtesting: how look-ahead is prevented

Three structural guarantees in `runBacktest()`:

1. The strategy receives `candles.slice(0, i + 1)`. A future bar is not
   reachable from the callback's scope.
2. A decision taken on bar `i` executes at bar `i+1`'s **open**. Filling at bar
   `i`'s close acts on a price that was not knowable until the bar ended.
3. When a bar touches **both** the stop and the target, the **stop** fills. The
   bar does not record which came first; assuming the favourable one is how
   backtests manufacture profit that does not exist.

Slippage and half-spread always work against the fill.

---

## 6. Risk engine

`assessRisk()` runs all 13 checks from spec §22 and returns every failure, not
just the first, so the UI can render a full checklist.

Checks: account, data freshness, market session, spread, volatility, position
size, daily loss, portfolio exposure, correlation, duplicate order, news event,
stop loss, risk/reward.

**Checks fail closed.** An unknown daily P&L, an unresolvable session or a
missing quote _blocks_ the trade. "We could not verify it" is not permission.

`assessLiveOrder()` adds the two live-only gates: live trading must be enabled
for the installation, and the user must have confirmed **this specific order**.
Orders are never submitted silently.

---

## 7. AI Copilot

The Copilot decides nothing. `buildCopilotMessages()` hands the model an
evidence packet of values the deterministic engines already computed, and the
system prompt restricts it to explaining them.

This split is the design: a model asked to "analyse the chart" will invent a
support level; a model handed computed levels and told to explain them cannot,
because the numbers are already fixed.

Missing sections render as `UNAVAILABLE` so the model cannot fill a gap, and an
empty news array is distinguished from an unconfigured provider.

`auditCopilotOutput()` detects guaranteed-profit, risk-free and fabricated
win-probability claims in the reply. It **flags** — it does not rewrite.

Because OmniRoute is itself an LLM router, the Copilot calls this installation's
own `/v1/chat/completions`. No new vendor dependency.

> **On "confidence".** `SignalResult.agreement` measures how strongly the
> factors concur. It is **not** a calibrated probability of profit and must
> never be presented as one.

---

## 8. Providers

The registry (`src/lib/trading/providers/registry.ts`) ships empty. This is not
an omission — registering a market-data adapter means writing one against a real
vendor API with real credentials. Until then, every read path reports
`DATA SOURCE UNAVAILABLE`.

To add one:

1. Implement the interface from `providers/types.ts` — every method returns
   `Availability<T>`, and an adapter must never synthesise a value it did not
   receive upstream.
2. Call `registerTradingProvider(adapter)` at startup.
3. Store credentials via `trading_provider_connections`, encrypting secret keys
   with `src/lib/db/encryption.ts`. Secrets are never returned by the REST layer.

`getActive*Provider()` returns the first **configured** adapter. Registration
alone is not enough, so a half-set-up vendor never silently becomes the source.

**Broker adapters are read-only by default.** `trading_enabled` defaults to `0`
and live execution stays off unless an operator turns it on.

---

## 9. REST API

All routes require `requireManagementAuth`, validate with Zod, and route errors
through `sanitizeErrorMessage()` (Hard Rule #12).

| Route                        | Method  | Purpose                                     |
| ---------------------------- | ------- | ------------------------------------------- |
| `/api/trading/status`        | GET     | Which provider kinds are configured (§42)   |
| `/api/trading/analyze`       | POST    | Full pipeline + Copilot evidence packet     |
| `/api/trading/position-size` | POST    | Sizing with true maximum loss               |
| `/api/trading/risk-settings` | GET/PUT | Read/update risk limits                     |
| `/api/trading/demo-series`   | GET     | Synthetic SIMULATED series for the UI (§32) |
| `/api/trading/copilot`       | POST    | Model narrative over the evidence packet    |

`/api/trading/analyze` takes candles in the request rather than fetching them,
so it works with any provider. `riskPerTradeFraction` is capped at `0.1` in the
route schema as well as in the engine.

---

## 10. User interface

`/dashboard/trading` (`src/app/(dashboard)/dashboard/trading/`). Desktop layout
per spec §33: status strip on top, watchlist left, chart centre, Copilot right,
docked analysis panels below.

| Component        | Role                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `StatusStrip`    | Equity, daily P&L, loss budget, session, **data status**, risk status             |
| `CandleChart`    | SVG candlesticks + volume + EMA/VWAP overlays + S/R and trade levels + crosshair  |
| `WatchlistPanel` | Symbol list with per-symbol score and state                                       |
| `CopilotPanel`   | Signal score, per-factor bars with evidence, warnings, reasoning, model narrative |
| `BottomPanels`   | Risk checklist, trade plan, structure, multi-timeframe                            |

The chart is hand-written SVG rather than a library: recharts (already a
dependency) has no candlestick mark, and price, volume, overlays and trade
levels need to share one coordinate space with a crosshair reading all of them.

Two rendering details that matter: the price scale is padded to the extremes of
the **wicks** so a long wick is never clipped, and overlay paths start a new
sub-path after every null so an indicator warm-up gap is a break in the line
rather than a straight segment across it.

### Honesty in the UI

- The data-status pill is the most prominent element on the page. `STALE` and
  `UNAVAILABLE` render red; `SIMULATED` renders amber.
- With no market-data adapter configured the page shows the provider's
  `unavailableMessage` verbatim and states that the chart below is synthetic.
- Watchlist rows show an em dash, never `0.00`, for values not yet computed.
- The score bar is labelled "factor agreement (not a win probability)".

### Demo mode

`/api/trading/demo-series` returns a seeded, deterministic synthetic series
stamped `SIMULATED` **server-side**, so a client cannot present it as live.
Because `SIMULATED` is not a tradeable status, the freshness gate disables live
analysis and the risk engine returns BLOCKED — the demo exercises the safety
property rather than bypassing it. Verified end to end: the terminal renders a
full chart and a complete 13-row risk checklist while refusing a tradeable
verdict.

This exists so the interface is usable before a real adapter is written. It is
not a data provider and must never become one.

---

## 11. Database

Migration `171_trading_terminal.sql`, 16 tables.

`trading_candles` is keyed `(symbol, timeframe, ts) WITHOUT ROWID` — the primary
key _is_ the range index for the only query shape that matters, so range scans
never touch a second structure. Candle upserts are last-write-wins, matching how
streaming feeds revise a forming bar.

Duplicate-order protection is a partial `UNIQUE` index on
`(account_id, client_order_id)`, enforced in the schema rather than only in
application code.

---

## 12. Testing

```bash
node --import tsx/esm --import ./tests/_setup/isolateDataDir.ts \
  --test --test-force-exit "tests/unit/trading/*.test.ts"
```

193 tests across six files:

| File                        | Covers                                       |
| --------------------------- | -------------------------------------------- |
| `indicators.test.ts`        | Indicator maths against hand-derived values  |
| `risk.test.ts`              | Sizing, the 13 risk checks, the entry engine |
| `analysis.test.ts`          | Freshness, structure, MTF, regime, signal    |
| `execution.test.ts`         | Look-ahead prevention, paper-trading P&L     |
| `portfolio-copilot.test.ts` | Correlation, journal, evidence packet        |
| `persistence.test.ts`       | Migration 171 on a real SQLite database      |
| `orchestrator.test.ts`      | End-to-end verdicts and risk vetoes          |

`tests/unit/trading` is registered in the `test:unit` glob, so CI runs it.

---

## 13. Not yet built

Stated plainly so nobody mistakes scope for completeness:

- **No provider adapters.** The contracts and registry exist; no vendor is
  implemented, so no live data flows yet.
- **No scanner surface.** The terminal ships watchlist, chart, Copilot and the
  analysis panels; the market-wide scanner (spec §27) is not built.
- **No drawing tools** on the chart (trendlines, freehand annotations).
- **No paper-trading or journal UI.** Both engines exist and are tested; neither
  has a screen yet.
- **No streaming runtime.** `MarketDataProvider.subscribe()` is defined but no
  reconnect/backpressure loop consumes it.
- **No alert dispatcher.** `trading_alerts` is modelled; nothing evaluates it.
- **No scanner or Strategy Lab rule compiler.** `runBacktest` takes a strategy
  function; the `IF/AND/OR/THEN` builder that produces one is not written.
- **No broker adapters** and no live order submission path.
