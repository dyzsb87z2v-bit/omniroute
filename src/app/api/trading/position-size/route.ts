/**
 * API: Position sizing (master spec §11).
 *
 * POST — Size a position from an entry, a stop and the configured risk limits.
 *
 * The response always includes the maximum loss INCLUDING fees and slippage, so
 * a client cannot present a size without the true risk attached.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { getRiskSettings } from "@/lib/db/trading";
import { calculatePositionSize, DEFAULT_COST_MODEL } from "@/lib/trading/positionSizing";

const bodySchema = z.object({
  accountId: z.string().max(200).nullable().optional(),
  entryPrice: z.number().positive().finite(),
  stopPrice: z.number().positive().finite(),
  side: z.enum(["long", "short"]),
  contractSize: z.number().positive().max(1_000_000).optional(),
  quantityIncrement: z.number().positive().max(1_000_000).optional(),
  riskMultiplier: z.number().min(0).max(1).optional(),
  costs: z
    .object({
      commissionRate: z.number().min(0).max(0.1),
      commissionFlat: z.number().min(0).max(10_000),
      slippageRate: z.number().min(0).max(0.1),
    })
    .optional(),
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

    const result = calculatePositionSize({
      entryPrice: body.entryPrice,
      stopPrice: body.stopPrice,
      side: body.side,
      settings: {
        accountEquity: stored.accountEquity,
        riskPerTradeFraction: stored.riskPerTradeFraction,
        maxDailyLossFraction: stored.maxDailyLossFraction,
        maxPositionFraction: stored.maxPositionFraction,
        maxPortfolioExposureFraction: stored.maxPortfolioExposureFraction,
        minRiskRewardRatio: stored.minRiskRewardRatio,
        maxLeverage: stored.maxLeverage,
      },
      costs: body.costs ?? DEFAULT_COST_MODEL,
      contractSize: body.contractSize,
      quantityIncrement: body.quantityIncrement,
      riskMultiplier: body.riskMultiplier,
    });

    return NextResponse.json({ sizing: result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to calculate position size" },
      { status: 500 }
    );
  }
}
