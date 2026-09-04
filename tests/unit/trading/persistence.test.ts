/**
 * Trading persistence against a real SQLite database (migration 171, §29, §41).
 *
 * These exercise the migration itself, not a mock: the tables, the indexes and
 * the upsert semantics all have to hold on the real driver.
 *
 * Per the repo's PII/DB learnings, the suite isolates DATA_DIR and closes every
 * handle in `after`, otherwise the node test runner hangs on an open SQLite
 * connection.
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir: string;
let db: typeof import("@/lib/db/trading");
let core: typeof import("@/lib/db/core");

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-trading-"));
  process.env.DATA_DIR = tempDir;
  process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
  core = await import("@/lib/db/core");
  core.getDbInstance();
  db = await import("@/lib/db/trading");
});

after(() => {
  try {
    core?.resetDbInstance?.();
  } catch {
    // The handle may already be closed; the directory cleanup below is what matters.
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("migration 171: every trading table exists after migrations run", () => {
  const instance = core.getDbInstance();
  const rows = instance
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'trading_%'")
    .all() as { name: string }[];
  const names = new Set(rows.map((r) => r.name));

  for (const expected of [
    "trading_instruments",
    "trading_candles",
    "trading_quotes",
    "trading_signals",
    "trading_news",
    "trading_economic_events",
    "trading_accounts",
    "trading_orders",
    "trading_positions",
    "trading_journal_entries",
    "trading_watchlists",
    "trading_alerts",
    "trading_strategies",
    "trading_backtests",
    "trading_risk_settings",
    "trading_provider_connections",
  ]) {
    assert.ok(names.has(expected), `missing table ${expected}`);
  }
});

test("instruments: upsert then read back", () => {
  db.upsertInstrument({
    symbol: "AAPL",
    assetClass: "stock",
    exchange: "XNAS",
    currency: "USD",
    sector: "tech",
  });
  const row = db.getInstrument("AAPL");
  assert.equal(row?.symbol, "AAPL");
  assert.equal(row?.sector, "tech");
  assert.equal(row?.contractSize, 1);
});

test("instruments: a second upsert updates rather than duplicating", () => {
  db.upsertInstrument({ symbol: "AAPL", assetClass: "stock", sector: "technology" });
  assert.equal(db.getInstrument("AAPL")?.sector, "technology");
  assert.equal(db.listInstruments().filter((i) => i.symbol === "AAPL").length, 1);
});

test("candles: stored with provenance and returned in ascending order", () => {
  db.upsertCandles("AAPL", "1H", [
    {
      timestamp: 3_000,
      open: 3,
      high: 4,
      low: 2,
      close: 3.5,
      volume: 10,
      source: "p",
      dataStatus: "HISTORICAL",
    },
    {
      timestamp: 1_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
      source: "p",
      dataStatus: "HISTORICAL",
    },
    {
      timestamp: 2_000,
      open: 2,
      high: 3,
      low: 1.5,
      close: 2.5,
      volume: 10,
      source: "p",
      dataStatus: "HISTORICAL",
    },
  ]);
  const candles = db.getCandles({ symbol: "AAPL", timeframe: "1H" });
  assert.deepEqual(
    candles.map((c) => c.timestamp),
    [1_000, 2_000, 3_000]
  );
  assert.equal(candles[0].source, "p");
  assert.equal(candles[0].dataStatus, "HISTORICAL");
});

test("candles: re-writing a bar revises it rather than duplicating (forming bars)", () => {
  db.upsertCandles("AAPL", "1H", [
    {
      timestamp: 3_000,
      open: 3,
      high: 9,
      low: 2,
      close: 8,
      volume: 99,
      source: "p",
      dataStatus: "LIVE",
    },
  ]);
  const candles = db.getCandles({ symbol: "AAPL", timeframe: "1H" });
  assert.equal(candles.length, 3, "the revision must not create a fourth bar");
  const revised = candles.find((c) => c.timestamp === 3_000);
  assert.equal(revised?.close, 8);
  assert.equal(revised?.dataStatus, "LIVE");
});

test("candles: range filters are inclusive-from and exclusive-to", () => {
  const candles = db.getCandles({ symbol: "AAPL", timeframe: "1H", from: 2_000, to: 3_000 });
  assert.deepEqual(
    candles.map((c) => c.timestamp),
    [2_000]
  );
});

test("candles: the limit takes the NEWEST bars, still returned ascending", () => {
  const candles = db.getCandles({ symbol: "AAPL", timeframe: "1H", limit: 2 });
  assert.deepEqual(
    candles.map((c) => c.timestamp),
    [2_000, 3_000]
  );
});

test("candles: timeframes are stored separately", () => {
  db.upsertCandles("AAPL", "1D", [
    {
      timestamp: 1_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
      source: "p",
      dataStatus: "HISTORICAL",
    },
  ]);
  assert.equal(db.getCandles({ symbol: "AAPL", timeframe: "1D" }).length, 1);
  assert.equal(db.getCandles({ symbol: "AAPL", timeframe: "1H" }).length, 3);
});

test("risk settings: first read creates conservative defaults", () => {
  const settings = db.getRiskSettings();
  assert.equal(settings.riskPerTradeFraction, 0.01);
  assert.equal(settings.maxDailyLossFraction, 0.03);
  assert.equal(settings.maxLeverage, 2);
  assert.equal(
    settings.blockAroundHighImpactEvents,
    true,
    "blocking around high-impact events must default ON (spec §14)"
  );
});

test("risk settings: updates persist and leave untouched fields alone", () => {
  db.updateRiskSettings(null, { accountEquity: 25_000, maxLeverage: 1 });
  const settings = db.getRiskSettings();
  assert.equal(settings.accountEquity, 25_000);
  assert.equal(settings.maxLeverage, 1);
  assert.equal(settings.riskPerTradeFraction, 0.01, "unrelated fields must not be reset");
});

test("risk settings: a boolean toggle round-trips correctly", () => {
  db.updateRiskSettings(null, { blockAroundHighImpactEvents: false });
  assert.equal(db.getRiskSettings().blockAroundHighImpactEvents, false);
  db.updateRiskSettings(null, { blockAroundHighImpactEvents: true });
  assert.equal(db.getRiskSettings().blockAroundHighImpactEvents, true);
});

test("signals: recorded with their factors so they stay explainable", () => {
  db.recordSignal({
    symbol: "AAPL",
    timeframe: "1H",
    timestamp: 5_000,
    score: 72,
    state: "BUY",
    grade: "B",
    agreement: 0.7,
    regime: "trending",
    tradeable: true,
    factors: [{ id: "trend.ema_structure", value: 0.6 }],
    warnings: [],
    explanation: "WHY BUY?",
    dataStatus: "LIVE",
    source: "test",
  });
  const signals = db.getRecentSignals("AAPL");
  assert.equal(signals.length, 1);
  assert.equal(signals[0].state, "BUY");
  assert.equal(signals[0].tradeable, true);
  assert.equal((signals[0].factors[0] as { id: string }).id, "trend.ema_structure");
});

test("provider connections: live trading defaults to OFF", () => {
  const connection = db.upsertProviderConnection({
    kind: "broker",
    providerId: "example-broker",
    label: "Example",
    enabled: true,
    config: { apiKey: "ciphertext" },
  });
  assert.equal(
    connection.tradingEnabled,
    false,
    "a broker connection must never enable live trading implicitly (spec §21)"
  );
  assert.equal(connection.enabled, true);
});

test("provider connections: (kind, providerId) is unique — re-adding updates", () => {
  db.upsertProviderConnection({
    kind: "broker",
    providerId: "example-broker",
    label: "Renamed",
    enabled: true,
  });
  const all = db.listProviderConnections("broker");
  assert.equal(all.length, 1);
  assert.equal(all[0].label, "Renamed");
});

test("provider connections: health results are recorded", () => {
  db.recordProviderHealth("broker", "example-broker", false, "unreachable");
  const connection = db.getProviderConnection("broker", "example-broker");
  assert.equal(connection?.lastHealthOk, false);
  assert.equal(connection?.lastHealthMessage, "unreachable");
});

test("journal: entries round-trip with their targets and R-multiple", () => {
  db.createJournalEntry({
    accountId: "acct-1",
    symbol: "AAPL",
    side: "long",
    openedAt: 1_000,
    closedAt: 2_000,
    entryPrice: 100,
    exitPrice: 110,
    stopPrice: 95,
    targetPrices: [110, 120, 130],
    quantity: 10,
    riskAmount: 50,
    rewardAmount: 100,
    fees: 2,
    netPnl: 98,
    rMultiple: 1.96,
    strategy: "breakout",
    marketRegime: "trending",
    signalScore: 78,
    aiAnalysis: null,
    notes: null,
    executionMode: "PAPER",
  });
  const entries = db.getJournalEntries("acct-1");
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].targetPrices, [110, 120, 130]);
  assert.equal(entries[0].executionMode, "PAPER");
  assert.equal(entries[0].rMultiple, 1.96);
});

test("watchlists: create, update and delete", () => {
  const watchlist = db.createWatchlist("Momentum", ["AAPL", "MSFT"]);
  assert.deepEqual(watchlist.symbols, ["AAPL", "MSFT"]);

  db.updateWatchlistSymbols(watchlist.id, ["AAPL", "MSFT", "NVDA"]);
  const updated = db.listWatchlists().find((w) => w.id === watchlist.id);
  assert.deepEqual(updated?.symbols, ["AAPL", "MSFT", "NVDA"]);

  db.deleteWatchlist(watchlist.id);
  assert.equal(
    db.listWatchlists().find((w) => w.id === watchlist.id),
    undefined
  );
});

test("backtests: results are persisted with their metrics", () => {
  const id = db.recordBacktest({
    strategyId: null,
    symbol: "AAPL",
    timeframe: "1D",
    fromTs: 0,
    toTs: 1_000,
    initialCapital: 10_000,
    riskPerTrade: 0.01,
    commissionRate: 0.001,
    slippageRate: 0.0005,
    metrics: { netProfit: 250, winRate: 0.55 },
    trades: [],
    warnings: [],
  });
  assert.ok(id);
  const listed = db.listBacktests("AAPL");
  assert.equal(listed.length, 1);
  assert.equal((listed[0].metrics as { netProfit: number }).netProfit, 250);
});
