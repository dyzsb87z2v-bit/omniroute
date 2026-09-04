-- Trading terminal schema (master spec §29).
--
-- Time-series tables (trading_candles) are indexed on their natural query
-- shape: "give me bars for symbol X on timeframe Y between t0 and t1". The
-- PRIMARY KEY doubles as that index, so range scans never touch a second
-- structure.
--
-- Every table that stores a market-dependent value also stores its provenance
-- (source + data_status), because a row without it cannot be trusted later.

CREATE TABLE IF NOT EXISTS trading_instruments (
  symbol TEXT PRIMARY KEY,
  asset_class TEXT NOT NULL,
  exchange TEXT,
  currency TEXT,
  contract_size REAL NOT NULL DEFAULT 1,
  tick_size REAL,
  sector TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_instruments_asset_class
  ON trading_instruments(asset_class);

CREATE TABLE IF NOT EXISTS trading_candles (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  -- Bar OPEN time, epoch ms, UTC.
  ts INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  data_status TEXT NOT NULL,
  PRIMARY KEY (symbol, timeframe, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS trading_quotes (
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  last REAL,
  bid REAL,
  ask REAL,
  volume REAL,
  vwap REAL,
  change_percent REAL,
  session TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL,
  data_status TEXT NOT NULL,
  PRIMARY KEY (symbol, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS trading_signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  ts INTEGER NOT NULL,
  score REAL NOT NULL,
  state TEXT NOT NULL,
  grade TEXT NOT NULL,
  agreement REAL NOT NULL,
  regime TEXT,
  tradeable INTEGER NOT NULL DEFAULT 0,
  -- Full factor array, so a past signal stays explainable (§34).
  factors TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  explanation TEXT,
  data_status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_signals_symbol_ts
  ON trading_signals(symbol, ts DESC);

CREATE TABLE IF NOT EXISTS trading_news (
  id TEXT PRIMARY KEY,
  headline TEXT NOT NULL,
  url TEXT,
  source TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  symbols TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  sentiment TEXT,
  impact TEXT,
  relevance REAL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_news_published
  ON trading_news(published_at DESC);

CREATE TABLE IF NOT EXISTS trading_economic_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  importance TEXT NOT NULL,
  previous TEXT,
  forecast TEXT,
  actual TEXT,
  currency TEXT,
  provider TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_events_scheduled
  ON trading_economic_events(scheduled_at);

CREATE TABLE IF NOT EXISTS trading_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- 'paper' or 'live'. Live accounts are read-only unless explicitly enabled.
  mode TEXT NOT NULL DEFAULT 'paper',
  currency TEXT NOT NULL DEFAULT 'USD',
  initial_capital REAL NOT NULL DEFAULT 0,
  cash REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  broker_connection_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_order_id TEXT,
  broker_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  limit_price REAL,
  stop_price REAL,
  status TEXT NOT NULL,
  filled_quantity REAL NOT NULL DEFAULT 0,
  average_fill_price REAL,
  fees REAL NOT NULL DEFAULT 0,
  reject_reason TEXT,
  -- 'PAPER' or 'LIVE': the two are never conflated in reporting (§20).
  execution_mode TEXT NOT NULL DEFAULT 'PAPER',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_orders_account
  ON trading_orders(account_id, created_at DESC);
-- Duplicate-order protection (§22 check 11) enforced in the schema, not just
-- in application code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_orders_client_id
  ON trading_orders(account_id, client_order_id)
  WHERE client_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trading_positions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  average_entry_price REAL NOT NULL,
  stop_price REAL,
  take_profit_price REAL,
  opened_at INTEGER NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  execution_mode TEXT NOT NULL DEFAULT 'PAPER',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_positions_account_symbol
  ON trading_positions(account_id, symbol);

CREATE TABLE IF NOT EXISTS trading_journal_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  entry_price REAL NOT NULL,
  exit_price REAL,
  stop_price REAL,
  target_prices TEXT NOT NULL DEFAULT '[]',
  quantity REAL NOT NULL,
  risk_amount REAL,
  reward_amount REAL,
  fees REAL NOT NULL DEFAULT 0,
  net_pnl REAL,
  r_multiple REAL,
  strategy TEXT,
  market_regime TEXT,
  signal_score REAL,
  ai_analysis TEXT,
  screenshot_path TEXT,
  notes TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'PAPER',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_journal_account_closed
  ON trading_journal_entries(account_id, closed_at DESC);

CREATE TABLE IF NOT EXISTS trading_watchlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbols TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  channels TEXT NOT NULL DEFAULT '[]',
  last_triggered_at INTEGER,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_alerts_symbol
  ON trading_alerts(symbol, enabled);

CREATE TABLE IF NOT EXISTS trading_strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  -- Serialised rule tree from the Strategy Lab (§19).
  definition TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_backtests (
  id TEXT PRIMARY KEY,
  strategy_id TEXT,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  initial_capital REAL NOT NULL,
  risk_per_trade REAL NOT NULL,
  commission_rate REAL NOT NULL DEFAULT 0,
  slippage_rate REAL NOT NULL DEFAULT 0,
  metrics TEXT NOT NULL DEFAULT '{}',
  trades TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_backtests_symbol
  ON trading_backtests(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS trading_risk_settings (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  account_equity REAL NOT NULL DEFAULT 0,
  risk_per_trade_fraction REAL NOT NULL DEFAULT 0.01,
  max_daily_loss_fraction REAL NOT NULL DEFAULT 0.03,
  max_position_fraction REAL NOT NULL DEFAULT 0.2,
  max_portfolio_exposure_fraction REAL NOT NULL DEFAULT 1,
  min_risk_reward_ratio REAL NOT NULL DEFAULT 1.5,
  max_leverage REAL NOT NULL DEFAULT 2,
  block_around_high_impact_events INTEGER NOT NULL DEFAULT 1,
  event_block_window_minutes INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_provider_connections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  -- JSON; secret keys arrive already encrypted (src/lib/db/encryption.ts).
  config TEXT NOT NULL DEFAULT '{}',
  -- Live execution is OFF unless the operator turns it on (§21).
  trading_enabled INTEGER NOT NULL DEFAULT 0,
  last_health_at INTEGER,
  last_health_ok INTEGER,
  last_health_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_provider_connections_kind_provider
  ON trading_provider_connections(kind, provider_id);
