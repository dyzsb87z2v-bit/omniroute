"use client";

/**
 * Trading terminal (master spec §33).
 *
 * Desktop layout: status strip on top, watchlist left, chart centre, Copilot
 * right, docked analysis panels below. On narrow screens the columns stack.
 *
 * The page never renders a market value it did not receive from the API. When
 * no market-data provider is configured it says so and offers the clearly
 * labelled SIMULATED generator instead of quietly showing invented prices.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Loading, Select } from "@/shared/components";
import { computeIndicatorSet } from "@/lib/trading/indicators";
import { CandleChart, type ChartLevel, type ChartOverlay } from "./components/CandleChart";
import { StatusStrip } from "./components/StatusStrip";
import { CopilotPanel } from "./components/CopilotPanel";
import { BottomPanels } from "./components/BottomPanels";
import { WatchlistPanel, type WatchlistRow } from "./components/WatchlistPanel";
import type {
  AnalysisView,
  ProviderStatusView,
  RiskSettingsView,
  TerminalCandle,
  TerminalQuote,
} from "./types";

const TIMEFRAMES = ["5m", "15m", "30m", "1H", "4H", "1D"] as const;
type TerminalTimeframe = (typeof TIMEFRAMES)[number];

const DEFAULT_SYMBOLS: { symbol: string; assetClass: string }[] = [
  { symbol: "AAPL", assetClass: "stock" },
  { symbol: "MSFT", assetClass: "stock" },
  { symbol: "NVDA", assetClass: "stock" },
  { symbol: "BTCUSD", assetClass: "crypto" },
  { symbol: "EURUSD", assetClass: "forex" },
];

interface SeriesState {
  candles: TerminalCandle[];
  quote: TerminalQuote | null;
  provenance: { source: string; timestamp: number; status: string };
  notice: string | null;
}

export function TradingTerminalClient() {
  const [providers, setProviders] = useState<ProviderStatusView[]>([]);
  const [settings, setSettings] = useState<RiskSettingsView | null>(null);
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [activeSymbol, setActiveSymbol] = useState(DEFAULT_SYMBOLS[0].symbol);
  const [timeframe, setTimeframe] = useState<TerminalTimeframe>("1H");
  const [draft, setDraft] = useState("");

  const [series, setSeries] = useState<SeriesState | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [scores, setScores] = useState<Record<string, { score: number; state: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [copilotModel, setCopilotModel] = useState("");
  const [copilotText, setCopilotText] = useState<string | null>(null);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotMessages, setCopilotMessages] = useState<
    { role: "system" | "user"; content: string }[] | null
  >(null);

  const marketDataProvider = providers.find((p) => p.kind === "market-data");
  const hasRealProvider = marketDataProvider?.available === true;

  const activeAssetClass =
    symbols.find((entry) => entry.symbol === activeSymbol)?.assetClass ?? "stock";

  /** Load provider availability and risk settings once. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusRes, settingsRes] = await Promise.all([
          fetch("/api/trading/status"),
          fetch("/api/trading/risk-settings"),
        ]);
        const statusData = await statusRes.json().catch(() => ({}));
        const settingsData = await settingsRes.json().catch(() => ({}));
        if (cancelled) return;
        if (Array.isArray(statusData.providers)) setProviders(statusData.providers);
        if (settingsData.settings) setSettings(settingsData.settings);
      } catch {
        if (!cancelled) setError("Could not reach the trading API.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Load a series for the active symbol and analyse it.
   *
   * With no market-data adapter registered there is nothing real to fetch, so
   * this uses the SIMULATED generator — whose provenance is stamped server-side
   * and therefore cannot be presented as live.
   */
  const loadSymbol = useCallback(
    async (symbol: string, assetClass: string, tf: TerminalTimeframe) => {
      setLoading(true);
      setError(null);
      setCopilotText(null);
      setCopilotError(null);
      try {
        const seriesRes = await fetch(
          `/api/trading/demo-series?symbol=${encodeURIComponent(symbol)}` +
            `&timeframe=${tf}&count=320&assetClass=${assetClass}`
        );
        const seriesData = await seriesRes.json().catch(() => ({}));
        if (!seriesRes.ok) throw new Error(seriesData.error || "Failed to load series");

        const loaded: SeriesState = {
          candles: seriesData.candles ?? [],
          quote: seriesData.quote ?? null,
          provenance: seriesData.provenance,
          notice: seriesData.notice ?? null,
        };
        setSeries(loaded);

        const analyzeRes = await fetch("/api/trading/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instrument: { symbol, assetClass },
            timeframe: tf,
            candles: loaded.candles,
            provenance: loaded.provenance,
            quote: loaded.quote
              ? {
                  last: loaded.quote.last,
                  bid: loaded.quote.bid,
                  ask: loaded.quote.ask,
                  volume: loaded.quote.volume,
                  vwap: loaded.quote.vwap,
                  changePercent: loaded.quote.changePercent,
                  session: loaded.quote.session,
                  provenance: loaded.quote.provenance,
                }
              : null,
            dailyPnl: 0,
            openPositions: [],
          }),
        });
        const analyzeData = await analyzeRes.json().catch(() => ({}));
        if (!analyzeRes.ok)
          throw new Error(analyzeData.error?.message || analyzeData.error || "Analysis failed");

        setAnalysis(analyzeData.analysis ?? null);
        setCopilotMessages(analyzeData.copilotMessages ?? null);
        if (analyzeData.analysis?.signal) {
          setScores((prev) => ({
            ...prev,
            [symbol]: {
              score: analyzeData.analysis.signal.score,
              state: analyzeData.analysis.signal.state,
            },
          }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load symbol");
        setAnalysis(null);
        setSeries(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadSymbol(activeSymbol, activeAssetClass, timeframe);
  }, [activeSymbol, activeAssetClass, timeframe, loadSymbol]);

  /** Chart overlays, computed from the same candles the chart draws. */
  const overlays: ChartOverlay[] = useMemo(() => {
    if (!series || series.candles.length === 0) return [];
    const indicators = computeIndicatorSet(series.candles);
    return [
      { id: "ema20", label: "EMA 20", color: "#3b82f6", values: indicators.ema20 },
      { id: "ema50", label: "EMA 50", color: "#a855f7", values: indicators.ema50 },
      { id: "ema200", label: "EMA 200", color: "#f59e0b", values: indicators.ema200 },
      { id: "vwap", label: "VWAP", color: "#14b8a6", values: indicators.vwap },
    ];
  }, [series]);

  /** Structural levels drawn on the chart, strongest first. */
  const chartLevels: ChartLevel[] = useMemo(() => {
    const structure = analysis?.structure;
    if (!structure) return [];
    return [
      ...structure.resistance.slice(0, 2).map((level) => ({
        price: level.price,
        label: "R",
        color: "#dc2626",
        dashed: true,
      })),
      ...structure.support.slice(0, 2).map((level) => ({
        price: level.price,
        label: "S",
        color: "#16a34a",
        dashed: true,
      })),
    ];
  }, [analysis]);

  const watchlistRows: WatchlistRow[] = symbols.map((entry) => {
    const isActive = entry.symbol === activeSymbol;
    const cached = scores[entry.symbol];
    return {
      symbol: entry.symbol,
      assetClass: entry.assetClass,
      last: isActive ? (series?.quote?.last ?? null) : null,
      changePercent: isActive ? (series?.quote?.changePercent ?? null) : null,
      score: cached?.score ?? null,
      state: cached?.state ?? null,
      dataStatus: isActive ? (analysis?.dataStatus ?? null) : null,
    };
  });

  const askCopilot = useCallback(async () => {
    if (!copilotMessages) return;
    if (!copilotModel.trim()) {
      setCopilotError("Enter a model id first (any model configured in OmniRoute).");
      return;
    }
    setCopilotLoading(true);
    setCopilotError(null);
    setCopilotText(null);
    try {
      const res = await fetch("/api/trading/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: copilotModel.trim(), messages: copilotMessages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Copilot request failed");
      setCopilotText(data.text);
      if (data.audit && data.audit.clean === false) {
        setCopilotError(
          `Output flagged: ${data.audit.violations.join(", ")}. Treat the text above with caution.`
        );
      }
    } catch (err) {
      setCopilotError(err instanceof Error ? err.message : "Copilot request failed");
    } finally {
      setCopilotLoading(false);
    }
  }, [copilotMessages, copilotModel]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Trading terminal</h1>
          <p className="text-xs text-text-muted">
            Signals, risk control and trade planning. Analysis only — no orders are placed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value as TerminalTimeframe)}
            aria-label="Timeframe"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void loadSymbol(activeSymbol, activeAssetClass, timeframe)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* §42: an unconfigured provider is stated, never hidden behind a chart. */}
      {!hasRealProvider ? (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge variant="warning" size="sm" dot>
              SIMULATED
            </Badge>
            <span className="text-xs font-medium">
              {marketDataProvider?.unavailableMessage ??
                "DATA SOURCE UNAVAILABLE — no market-data provider is configured."}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-text-muted">
            {series?.notice ??
              "The chart below is a synthetic series for interface demonstration only. It is not market data."}{" "}
            Because the data is <span className="font-mono">SIMULATED</span>, the freshness gate
            disables live analysis and the risk engine cannot return a tradeable verdict — exactly
            as it would on a stale live feed.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <StatusStrip analysis={analysis} settings={settings} dailyPnl={0} loading={loading} />

      <div className="grid gap-3 lg:h-[620px] lg:grid-cols-[220px_minmax(0,1fr)_340px]">
        <Card title="Watchlist" padding="sm" className="lg:h-full lg:overflow-hidden">
          <WatchlistPanel
            rows={watchlistRows}
            activeSymbol={activeSymbol}
            onSelect={setActiveSymbol}
            onAdd={(symbol) => {
              if (!symbols.some((entry) => entry.symbol === symbol)) {
                setSymbols((prev) => [...prev, { symbol, assetClass: "stock" }]);
              }
              setActiveSymbol(symbol);
              setDraft("");
            }}
            onRemove={(symbol) => {
              setSymbols((prev) => {
                const next = prev.filter((entry) => entry.symbol !== symbol);
                if (symbol === activeSymbol && next.length > 0) setActiveSymbol(next[0].symbol);
                return next;
              });
            }}
            draft={draft}
            onDraftChange={setDraft}
          />
        </Card>

        <Card
          padding="sm"
          className="lg:h-full lg:overflow-hidden"
          title={
            <span className="flex items-center gap-2">
              <span className="font-mono">{activeSymbol}</span>
              <span className="text-xs font-normal text-text-muted">{timeframe}</span>
              {series?.quote?.last != null ? (
                <span className="font-mono text-sm">{series.quote.last.toFixed(2)}</span>
              ) : null}
            </span>
          }
        >
          {loading && !series ? (
            <div className="flex h-[420px] items-center justify-center">
              <Loading />
            </div>
          ) : (
            <CandleChart
              candles={series?.candles ?? []}
              overlays={overlays}
              levels={chartLevels}
              plan={analysis?.levels ?? null}
              height={420}
              watermark={analysis?.dataStatus === "SIMULATED" ? "SIMULATED" : undefined}
            />
          )}
        </Card>

        <div className="flex flex-col gap-3 lg:h-full lg:overflow-y-auto lg:pr-1">
          <Card padding="sm" title="Copilot model">
            <input
              value={copilotModel}
              onChange={(event) => setCopilotModel(event.target.value)}
              placeholder="e.g. gpt-4o-mini"
              className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
              aria-label="Copilot model id"
            />
            <p className="mt-1 text-[10px] text-text-muted">
              Routed through this OmniRoute installation&apos;s own chat endpoint.
            </p>
          </Card>
          <CopilotPanel
            analysis={analysis}
            copilotText={copilotText}
            copilotLoading={copilotLoading}
            copilotError={copilotError}
            onAskCopilot={() => void askCopilot()}
          />
        </div>
      </div>

      <BottomPanels analysis={analysis} />

      <p className="text-[10px] leading-snug text-text-muted">
        This terminal provides analysis and risk control only. It does not place orders, does not
        predict prices, and makes no guarantee of any outcome. NO TRADE and WAIT are valid results.
      </p>
    </div>
  );
}
