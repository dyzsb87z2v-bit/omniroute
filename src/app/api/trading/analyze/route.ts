/**
 * API: Full instrument analysis (master spec §8, §9, §10, §12, §37, §42).
 *
 * POST — Run the whole pipeline over candles the caller supplies and return an
 * explainable trade plan, a risk verdict and the Copilot evidence packet.
 *
 * Candles come from the request rather than being fetched here so this endpoint
 * stays usable with any provider (§2). When no market-data provider is
 * configured the caller has nothing to send, and the response says so instead of
 * inventing a series (§42).
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { getRiskSettings } from "@/lib/db/trading";
import { analyzeInstrument } from "@/lib/trading/analysisService";
import { normalizeCandles } from "@/lib/trading/freshness";
import { ALL_TIMEFRAMES, type Timeframe } from "@/lib/trading/types";

const candleSchema = z.object({
  timestamp: z.number().int().finite(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().min(0).finite(),
});

const timeframeSchema = z.enum(ALL_TIMEFRAMES as unknown as [Timeframe, ...Timeframe[]]);

const dataStatusSchema = z.enum([
  "LIVE",
  "DELAYED",
  "HISTORICAL",
  "PAPER",
  "SIMULATED",
  "STALE",
  "UNAVAILABLE",
]);

const bodySchema = z.object({
  accountId: z.string().max(200).nullable().optional(),
  instrument: z.object({
    symbol: z.string().min(1).max(64),
    assetClass: z.enum(["stock", "etf", "index", "forex", "crypto"]),
    exchange: z.string().max(32).optional(),
    currency: z.string().max(8).optional(),
    contractSize: z.number().positive().max(1_000_000).optional(),
  }),
  timeframe: timeframeSchema,
  // 20,000 bars is generous for any chart while bounding the request body.
  candles: z.array(candleSchema).min(1).max(20_000),
  provenance: z.object({
    source: z.string().min(1).max(64),
    timestamp: z.number().int().finite(),
    status: dataStatusSchema,
  }),
  additionalSeries: z
    .array(
      z.object({
        timeframe: timeframeSchema,
        candles: z.array(candleSchema).min(1).max(20_000),
      })
    )
    .max(6)
    .optional(),
  quote: z
    .object({
      last: z.number().finite().nullable(),
      bid: z.number().finite().nullable(),
      ask: z.number().finite().nullable(),
      volume: z.number().finite().nullable(),
      vwap: z.number().finite().nullable(),
      changePercent: z.number().finite().nullable(),
      session: z.enum(["pre", "regular", "post", "closed", "unknown"]),
      provenance: z.object({
        source: z.string().min(1).max(64),
        timestamp: z.number().int().finite(),
        status: dataStatusSchema,
      }),
    })
    .nullable()
    .optional(),
  side: z.enum(["long", "short"]).optional(),
  dailyPnl: z.number().finite().nullable().optional(),
  openPositions: z
    .array(
      z.object({
        symbol: z.string().min(1).max(64),
        side: z.enum(["long", "short"]),
        notional: z.number().finite(),
        correlationGroup: z.string().max(64).optional(),
      })
    )
    .max(500)
    .optional(),
  correlationGroup: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const validation = validateBody(bodySchema, await request.json());
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const body = validation.data;
    const stored = getRiskSettings(body.accountId ?? null);

    const instrument = {
      symbol: body.instrument.symbol,
      assetClass: body.instrument.assetClass,
      exchange: body.instrument.exchange,
      currency: body.instrument.currency,
      contractSize: body.instrument.contractSize,
    };

    // Normalise before analysing: a provider series can arrive out of order or
    // with duplicate bars, and indicator maths on such a series is meaningless.
    const candles = normalizeCandles(body.candles);

    const result = analyzeInstrument({
      series: {
        instrument,
        timeframe: body.timeframe,
        candles,
        provenance: body.provenance,
      },
      additionalSeries: body.additionalSeries?.map((entry) => ({
        timeframe: entry.timeframe,
        candles: normalizeCandles(entry.candles),
      })),
      quote: body.quote
        ? {
            instrument,
            last: body.quote.last,
            bid: body.quote.bid,
            ask: body.quote.ask,
            spread:
              body.quote.bid !== null && body.quote.ask !== null
                ? body.quote.ask - body.quote.bid
                : null,
            volume: body.quote.volume,
            tradeCount: null,
            vwap: body.quote.vwap,
            changePercent: body.quote.changePercent,
            session: body.quote.session,
            provenance: body.quote.provenance,
          }
        : null,
      settings: {
        accountEquity: stored.accountEquity,
        riskPerTradeFraction: stored.riskPerTradeFraction,
        maxDailyLossFraction: stored.maxDailyLossFraction,
        maxPositionFraction: stored.maxPositionFraction,
        maxPortfolioExposureFraction: stored.maxPortfolioExposureFraction,
        minRiskRewardRatio: stored.minRiskRewardRatio,
        maxLeverage: stored.maxLeverage,
      },
      side: body.side,
      dailyPnl: body.dailyPnl ?? null,
      openPositions: body.openPositions,
      correlationGroup: body.correlationGroup,
    });

    // The Copilot messages are large and only needed when the client is about to
    // call the model; they are returned under an explicit key rather than inlined.
    const { copilotMessages, ...analysis } = result;
    return NextResponse.json({ analysis, copilotMessages });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to analyze instrument" },
      { status: 500 }
    );
  }
}
