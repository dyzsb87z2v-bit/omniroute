/**
 * Trading terminal persistence (migration 171, master spec §29).
 *
 * snake_case in SQLite, camelCase in the returned objects — the convention used
 * across src/lib/db. Every read path that returns a market value also returns
 * its `source` and `dataStatus`, so a caller can never lose track of where a
 * number came from (§32).
 *
 * Secrets inside `trading_provider_connections.config` arrive already encrypted;
 * encryption belongs with the provider registry, not with persistence.
 */

import { randomUUID } from "node:crypto";
import { getDbInstance } from "./core";

type Row = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export interface InstrumentRow {
  symbol: string;
  assetClass: string;
  exchange: string | null;
  currency: string | null;
  contractSize: number;
  tickSize: number | null;
  sector: string | null;
}

export function upsertInstrument(input: {
  symbol: string;
  assetClass: string;
  exchange?: string | null;
  currency?: string | null;
  contractSize?: number;
  tickSize?: number | null;
  sector?: string | null;
}): void {
  const db = getDbInstance();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO trading_instruments
       (symbol, asset_class, exchange, currency, contract_size, tick_size, sector, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       asset_class = excluded.asset_class,
       exchange = excluded.exchange,
       currency = excluded.currency,
       contract_size = excluded.contract_size,
       tick_size = excluded.tick_size,
       sector = excluded.sector,
       updated_at = excluded.updated_at`
  ).run(
    input.symbol,
    input.assetClass,
    input.exchange ?? null,
    input.currency ?? null,
    input.contractSize ?? 1,
    input.tickSize ?? null,
    input.sector ?? null,
    timestamp,
    timestamp
  );
}

export function getInstrument(symbol: string): InstrumentRow | null {
  const db = getDbInstance();
  const row = db.prepare("SELECT * FROM trading_instruments WHERE symbol = ?").get(symbol) as
    Row | undefined;
  return row ? mapInstrument(row) : null;
}

export function listInstruments(): InstrumentRow[] {
  const db = getDbInstance();
  const rows = db.prepare("SELECT * FROM trading_instruments ORDER BY symbol").all() as Row[];
  return rows.map(mapInstrument);
}

function mapInstrument(row: Row): InstrumentRow {
  return {
    symbol: row.symbol as string,
    assetClass: row.asset_class as string,
    exchange: (row.exchange as string) ?? null,
    currency: (row.currency as string) ?? null,
    contractSize: (row.contract_size as number) ?? 1,
    tickSize: (row.tick_size as number) ?? null,
    sector: (row.sector as string) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

export interface StoredCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  dataStatus: string;
}

/**
 * Insert or replace bars. A forming bar is revised many times before it closes,
 * so the upsert is last-write-wins on (symbol, timeframe, ts) — matching how
 * streaming feeds actually behave.
 */
export function upsertCandles(
  symbol: string,
  timeframe: string,
  candles: readonly StoredCandle[]
): number {
  if (candles.length === 0) return 0;
  const db = getDbInstance();
  const statement = db.prepare(
    `INSERT INTO trading_candles
       (symbol, timeframe, ts, open, high, low, close, volume, source, data_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, timeframe, ts) DO UPDATE SET
       open = excluded.open,
       high = excluded.high,
       low = excluded.low,
       close = excluded.close,
       volume = excluded.volume,
       source = excluded.source,
       data_status = excluded.data_status`
  );
  let written = 0;
  for (const candle of candles) {
    statement.run(
      symbol,
      timeframe,
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.source,
      candle.dataStatus
    );
    written++;
  }
  return written;
}

export function getCandles(params: {
  symbol: string;
  timeframe: string;
  from?: number;
  to?: number;
  limit?: number;
}): StoredCandle[] {
  const db = getDbInstance();
  const clauses = ["symbol = ?", "timeframe = ?"];
  const args: (string | number)[] = [params.symbol, params.timeframe];
  if (params.from !== undefined) {
    clauses.push("ts >= ?");
    args.push(params.from);
  }
  if (params.to !== undefined) {
    clauses.push("ts < ?");
    args.push(params.to);
  }

  // Take the NEWEST `limit` bars, then re-sort ascending: a chart wants the most
  // recent window, but every indicator needs chronological order.
  const limit = params.limit ?? 5_000;
  const rows = db
    .prepare(
      `SELECT * FROM trading_candles
       WHERE ${clauses.join(" AND ")}
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(...args, limit) as Row[];

  return rows
    .map((row) => ({
      timestamp: row.ts as number,
      open: row.open as number,
      high: row.high as number,
      low: row.low as number,
      close: row.close as number,
      volume: row.volume as number,
      source: row.source as string,
      dataStatus: row.data_status as string,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function deleteCandlesOlderThan(cutoffMs: number): number {
  const db = getDbInstance();
  const result = db.prepare("DELETE FROM trading_candles WHERE ts < ?").run(cutoffMs);
  return Number(result.changes ?? 0);
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface StoredSignal {
  id: string;
  symbol: string;
  timeframe: string;
  timestamp: number;
  score: number;
  state: string;
  grade: string;
  agreement: number;
  regime: string | null;
  tradeable: boolean;
  factors: unknown[];
  warnings: unknown[];
  explanation: string | null;
  dataStatus: string;
  source: string;
  createdAt: string;
}

export function recordSignal(input: Omit<StoredSignal, "id" | "createdAt">): StoredSignal {
  const db = getDbInstance();
  const id = randomUUID();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO trading_signals
       (id, symbol, timeframe, ts, score, state, grade, agreement, regime, tradeable,
        factors, warnings, explanation, data_status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.symbol,
    input.timeframe,
    input.timestamp,
    input.score,
    input.state,
    input.grade,
    input.agreement,
    input.regime,
    input.tradeable ? 1 : 0,
    JSON.stringify(input.factors),
    JSON.stringify(input.warnings),
    input.explanation,
    input.dataStatus,
    input.source,
    createdAt
  );
  return { ...input, id, createdAt };
}

export function getRecentSignals(symbol: string, limit = 50): StoredSignal[] {
  const db = getDbInstance();
  const rows = db
    .prepare("SELECT * FROM trading_signals WHERE symbol = ? ORDER BY ts DESC LIMIT ?")
    .all(symbol, limit) as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    symbol: row.symbol as string,
    timeframe: row.timeframe as string,
    timestamp: row.ts as number,
    score: row.score as number,
    state: row.state as string,
    grade: row.grade as string,
    agreement: row.agreement as number,
    regime: (row.regime as string) ?? null,
    tradeable: row.tradeable === 1,
    factors: parseJson<unknown[]>(row.factors, []),
    warnings: parseJson<unknown[]>(row.warnings, []),
    explanation: (row.explanation as string) ?? null,
    dataStatus: row.data_status as string,
    source: row.source as string,
    createdAt: row.created_at as string,
  }));
}

// ---------------------------------------------------------------------------
// Risk settings
// ---------------------------------------------------------------------------

export interface StoredRiskSettings {
  id: string;
  accountId: string | null;
  accountEquity: number;
  riskPerTradeFraction: number;
  maxDailyLossFraction: number;
  maxPositionFraction: number;
  maxPortfolioExposureFraction: number;
  minRiskRewardRatio: number;
  maxLeverage: number;
  blockAroundHighImpactEvents: boolean;
  eventBlockWindowMinutes: number;
  updatedAt: string;
}

const DEFAULT_RISK_SETTINGS_ID = "default";

/**
 * Read the risk settings, creating conservative defaults on first access.
 * Defaults are deliberately restrictive: an operator who has not configured
 * risk limits should get the safe ones, not permissive placeholders.
 */
export function getRiskSettings(accountId: string | null = null): StoredRiskSettings {
  const db = getDbInstance();
  const id = accountId ?? DEFAULT_RISK_SETTINGS_ID;
  const row = db.prepare("SELECT * FROM trading_risk_settings WHERE id = ?").get(id) as
    Row | undefined;

  if (!row) {
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO trading_risk_settings (id, account_id, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).run(id, accountId, timestamp);
    return {
      id,
      accountId,
      accountEquity: 0,
      riskPerTradeFraction: 0.01,
      maxDailyLossFraction: 0.03,
      maxPositionFraction: 0.2,
      maxPortfolioExposureFraction: 1,
      minRiskRewardRatio: 1.5,
      maxLeverage: 2,
      blockAroundHighImpactEvents: true,
      eventBlockWindowMinutes: 30,
      updatedAt: timestamp,
    };
  }

  return {
    id: row.id as string,
    accountId: (row.account_id as string) ?? null,
    accountEquity: row.account_equity as number,
    riskPerTradeFraction: row.risk_per_trade_fraction as number,
    maxDailyLossFraction: row.max_daily_loss_fraction as number,
    maxPositionFraction: row.max_position_fraction as number,
    maxPortfolioExposureFraction: row.max_portfolio_exposure_fraction as number,
    minRiskRewardRatio: row.min_risk_reward_ratio as number,
    maxLeverage: row.max_leverage as number,
    blockAroundHighImpactEvents: row.block_around_high_impact_events === 1,
    eventBlockWindowMinutes: row.event_block_window_minutes as number,
    updatedAt: row.updated_at as string,
  };
}

export function updateRiskSettings(
  accountId: string | null,
  updates: Partial<Omit<StoredRiskSettings, "id" | "accountId" | "updatedAt">>
): StoredRiskSettings {
  getRiskSettings(accountId); // ensure the row exists
  const db = getDbInstance();
  const id = accountId ?? DEFAULT_RISK_SETTINGS_ID;

  const columns: Record<string, string> = {
    accountEquity: "account_equity",
    riskPerTradeFraction: "risk_per_trade_fraction",
    maxDailyLossFraction: "max_daily_loss_fraction",
    maxPositionFraction: "max_position_fraction",
    maxPortfolioExposureFraction: "max_portfolio_exposure_fraction",
    minRiskRewardRatio: "min_risk_reward_ratio",
    maxLeverage: "max_leverage",
    blockAroundHighImpactEvents: "block_around_high_impact_events",
    eventBlockWindowMinutes: "event_block_window_minutes",
  };

  const assignments: string[] = [];
  const args: (string | number)[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = (updates as Record<string, unknown>)[key];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    args.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as number));
  }

  if (assignments.length > 0) {
    assignments.push("updated_at = ?");
    args.push(nowIso());
    db.prepare(`UPDATE trading_risk_settings SET ${assignments.join(", ")} WHERE id = ?`).run(
      ...args,
      id
    );
  }
  return getRiskSettings(accountId);
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export interface StoredJournalEntry {
  id: string;
  accountId: string;
  symbol: string;
  side: string;
  openedAt: number;
  closedAt: number | null;
  entryPrice: number;
  exitPrice: number | null;
  stopPrice: number | null;
  targetPrices: number[];
  quantity: number;
  riskAmount: number | null;
  rewardAmount: number | null;
  fees: number;
  netPnl: number | null;
  rMultiple: number | null;
  strategy: string | null;
  marketRegime: string | null;
  signalScore: number | null;
  aiAnalysis: string | null;
  notes: string | null;
  executionMode: string;
}

export function createJournalEntry(input: Omit<StoredJournalEntry, "id">): StoredJournalEntry {
  const db = getDbInstance();
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO trading_journal_entries
       (id, account_id, symbol, side, opened_at, closed_at, entry_price, exit_price,
        stop_price, target_prices, quantity, risk_amount, reward_amount, fees, net_pnl,
        r_multiple, strategy, market_regime, signal_score, ai_analysis, notes,
        execution_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.accountId,
    input.symbol,
    input.side,
    input.openedAt,
    input.closedAt,
    input.entryPrice,
    input.exitPrice,
    input.stopPrice,
    JSON.stringify(input.targetPrices),
    input.quantity,
    input.riskAmount,
    input.rewardAmount,
    input.fees,
    input.netPnl,
    input.rMultiple,
    input.strategy,
    input.marketRegime,
    input.signalScore,
    input.aiAnalysis,
    input.notes,
    input.executionMode,
    timestamp,
    timestamp
  );
  return { ...input, id };
}

export function getJournalEntries(accountId: string, limit = 500): StoredJournalEntry[] {
  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT * FROM trading_journal_entries
       WHERE account_id = ?
       ORDER BY COALESCE(closed_at, opened_at) DESC
       LIMIT ?`
    )
    .all(accountId, limit) as Row[];

  return rows.map((row) => ({
    id: row.id as string,
    accountId: row.account_id as string,
    symbol: row.symbol as string,
    side: row.side as string,
    openedAt: row.opened_at as number,
    closedAt: (row.closed_at as number) ?? null,
    entryPrice: row.entry_price as number,
    exitPrice: (row.exit_price as number) ?? null,
    stopPrice: (row.stop_price as number) ?? null,
    targetPrices: parseJson<number[]>(row.target_prices, []),
    quantity: row.quantity as number,
    riskAmount: (row.risk_amount as number) ?? null,
    rewardAmount: (row.reward_amount as number) ?? null,
    fees: row.fees as number,
    netPnl: (row.net_pnl as number) ?? null,
    rMultiple: (row.r_multiple as number) ?? null,
    strategy: (row.strategy as string) ?? null,
    marketRegime: (row.market_regime as string) ?? null,
    signalScore: (row.signal_score as number) ?? null,
    aiAnalysis: (row.ai_analysis as string) ?? null,
    notes: (row.notes as string) ?? null,
    executionMode: row.execution_mode as string,
  }));
}

// ---------------------------------------------------------------------------
// Watchlists
// ---------------------------------------------------------------------------

export interface StoredWatchlist {
  id: string;
  name: string;
  symbols: string[];
  createdAt: string;
  updatedAt: string;
}

export function createWatchlist(name: string, symbols: readonly string[]): StoredWatchlist {
  const db = getDbInstance();
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    "INSERT INTO trading_watchlists (id, name, symbols, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, JSON.stringify(symbols), timestamp, timestamp);
  return { id, name, symbols: [...symbols], createdAt: timestamp, updatedAt: timestamp };
}

export function listWatchlists(): StoredWatchlist[] {
  const db = getDbInstance();
  const rows = db.prepare("SELECT * FROM trading_watchlists ORDER BY created_at").all() as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    symbols: parseJson<string[]>(row.symbols, []),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export function updateWatchlistSymbols(id: string, symbols: readonly string[]): void {
  const db = getDbInstance();
  db.prepare("UPDATE trading_watchlists SET symbols = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(symbols),
    nowIso(),
    id
  );
}

export function deleteWatchlist(id: string): void {
  getDbInstance().prepare("DELETE FROM trading_watchlists WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Provider connections
// ---------------------------------------------------------------------------

export interface StoredProviderConnection {
  id: string;
  kind: string;
  providerId: string;
  label: string;
  enabled: boolean;
  config: Record<string, unknown>;
  tradingEnabled: boolean;
  lastHealthAt: number | null;
  lastHealthOk: boolean | null;
  lastHealthMessage: string | null;
}

export function upsertProviderConnection(input: {
  kind: string;
  providerId: string;
  label: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  tradingEnabled?: boolean;
}): StoredProviderConnection {
  const db = getDbInstance();
  const timestamp = nowIso();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO trading_provider_connections
       (id, kind, provider_id, label, enabled, config, trading_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, provider_id) DO UPDATE SET
       label = excluded.label,
       enabled = excluded.enabled,
       config = excluded.config,
       trading_enabled = excluded.trading_enabled,
       updated_at = excluded.updated_at`
  ).run(
    id,
    input.kind,
    input.providerId,
    input.label,
    input.enabled === true ? 1 : 0,
    JSON.stringify(input.config ?? {}),
    // Live trading stays off unless explicitly requested (§21).
    input.tradingEnabled === true ? 1 : 0,
    timestamp,
    timestamp
  );
  return getProviderConnection(input.kind, input.providerId) as StoredProviderConnection;
}

export function getProviderConnection(
  kind: string,
  providerId: string
): StoredProviderConnection | null {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT * FROM trading_provider_connections WHERE kind = ? AND provider_id = ?")
    .get(kind, providerId) as Row | undefined;
  return row ? mapProviderConnection(row) : null;
}

export function listProviderConnections(kind?: string): StoredProviderConnection[] {
  const db = getDbInstance();
  const rows = (
    kind
      ? db
          .prepare("SELECT * FROM trading_provider_connections WHERE kind = ? ORDER BY label")
          .all(kind)
      : db.prepare("SELECT * FROM trading_provider_connections ORDER BY kind, label").all()
  ) as Row[];
  return rows.map(mapProviderConnection);
}

export function recordProviderHealth(
  kind: string,
  providerId: string,
  ok: boolean,
  message: string
): void {
  getDbInstance()
    .prepare(
      `UPDATE trading_provider_connections
       SET last_health_at = ?, last_health_ok = ?, last_health_message = ?, updated_at = ?
       WHERE kind = ? AND provider_id = ?`
    )
    .run(Date.now(), ok ? 1 : 0, message, nowIso(), kind, providerId);
}

function mapProviderConnection(row: Row): StoredProviderConnection {
  return {
    id: row.id as string,
    kind: row.kind as string,
    providerId: row.provider_id as string,
    label: row.label as string,
    enabled: row.enabled === 1,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    tradingEnabled: row.trading_enabled === 1,
    lastHealthAt: (row.last_health_at as number) ?? null,
    lastHealthOk:
      row.last_health_ok === null || row.last_health_ok === undefined
        ? null
        : row.last_health_ok === 1,
    lastHealthMessage: (row.last_health_message as string) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Backtests
// ---------------------------------------------------------------------------

export function recordBacktest(input: {
  strategyId: string | null;
  symbol: string;
  timeframe: string;
  fromTs: number;
  toTs: number;
  initialCapital: number;
  riskPerTrade: number;
  commissionRate: number;
  slippageRate: number;
  metrics: unknown;
  trades: unknown;
  warnings: unknown;
}): string {
  const db = getDbInstance();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO trading_backtests
       (id, strategy_id, symbol, timeframe, from_ts, to_ts, initial_capital, risk_per_trade,
        commission_rate, slippage_rate, metrics, trades, warnings, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.strategyId,
    input.symbol,
    input.timeframe,
    input.fromTs,
    input.toTs,
    input.initialCapital,
    input.riskPerTrade,
    input.commissionRate,
    input.slippageRate,
    JSON.stringify(input.metrics),
    JSON.stringify(input.trades),
    JSON.stringify(input.warnings),
    nowIso()
  );
  return id;
}

export function listBacktests(symbol?: string, limit = 50): Row[] {
  const db = getDbInstance();
  const rows = (
    symbol
      ? db
          .prepare(
            "SELECT id, strategy_id, symbol, timeframe, from_ts, to_ts, metrics, created_at FROM trading_backtests WHERE symbol = ? ORDER BY created_at DESC LIMIT ?"
          )
          .all(symbol, limit)
      : db
          .prepare(
            "SELECT id, strategy_id, symbol, timeframe, from_ts, to_ts, metrics, created_at FROM trading_backtests ORDER BY created_at DESC LIMIT ?"
          )
          .all(limit)
  ) as Row[];
  return rows.map((row) => ({
    id: row.id,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    fromTs: row.from_ts,
    toTs: row.to_ts,
    metrics: parseJson<Record<string, unknown>>(row.metrics, {}),
    createdAt: row.created_at,
  }));
}
