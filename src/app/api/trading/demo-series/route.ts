/**
 * API: Simulated market series (master spec §32).
 *
 * GET — Return a synthetic candle series and quote for interface demonstration.
 *
 * The `SIMULATED` provenance is applied SERVER-SIDE and cannot be overridden by
 * the caller, so a client can never present this data as live. Because
 * `SIMULATED` is not a tradeable status, anything analysed from it is refused a
 * tradeable verdict by the freshness gate.
 *
 * This route exists so the terminal is usable before a real market-data adapter
 * is configured. It is not a data provider and must never become one.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  SIMULATED_DATA_NOTICE,
  generateSimulatedCandles,
  generateSimulatedQuote,
} from "@/lib/trading/simulatedMarket";
import { ALL_TIMEFRAMES, type Timeframe } from "@/lib/trading/types";

const querySchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(16)
    // Restricted to a symbol shape so the value is safe to echo back.
    .regex(/^[A-Za-z0-9._-]+$/),
  timeframe: z.enum(ALL_TIMEFRAMES as unknown as [Timeframe, ...Timeframe[]]),
  count: z.coerce.number().int().min(50).max(1500),
  assetClass: z.enum(["stock", "etf", "index", "forex", "crypto"]),
});

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      symbol: url.searchParams.get("symbol") ?? "DEMO",
      timeframe: url.searchParams.get("timeframe") ?? "1H",
      count: url.searchParams.get("count") ?? "300",
      assetClass: url.searchParams.get("assetClass") ?? "stock",
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid demo series parameters" }, { status: 400 });
    }

    const { symbol, timeframe, count, assetClass } = parsed.data;
    const instrument = { symbol: symbol.toUpperCase(), assetClass };
    const candles = generateSimulatedCandles({
      symbol: instrument.symbol,
      timeframe,
      count,
    });

    return NextResponse.json({
      notice: SIMULATED_DATA_NOTICE,
      instrument,
      timeframe,
      candles,
      quote: generateSimulatedQuote(instrument, candles),
      provenance: {
        source: "simulated-generator",
        timestamp: candles[candles.length - 1]?.timestamp ?? Date.now(),
        // Stamped here, server-side. The client cannot ask for a different one.
        status: "SIMULATED" as const,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to generate simulated series" },
      { status: 500 }
    );
  }
}
