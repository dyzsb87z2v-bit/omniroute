/**
 * API: Risk settings (master spec §11, §12).
 *
 * GET — Read the configured risk limits.
 * PUT — Update them.
 *
 * Bounds on every field are enforced here as well as in the engine: a UI bug
 * must not be able to persist a 50% per-trade risk.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { getRiskSettings, updateRiskSettings } from "@/lib/db/trading";

const updateSchema = z.object({
  accountId: z.string().max(200).nullable().optional(),
  accountEquity: z.number().min(0).max(1_000_000_000).optional(),
  // Capped at 10%: anything above is not risk management, it is gambling.
  riskPerTradeFraction: z.number().min(0).max(0.1).optional(),
  maxDailyLossFraction: z.number().min(0).max(0.5).optional(),
  maxPositionFraction: z.number().min(0).max(1).optional(),
  maxPortfolioExposureFraction: z.number().min(0).max(10).optional(),
  minRiskRewardRatio: z.number().min(0).max(100).optional(),
  maxLeverage: z.number().min(0).max(50).optional(),
  blockAroundHighImpactEvents: z.boolean().optional(),
  eventBlockWindowMinutes: z.number().int().min(0).max(1440).optional(),
});

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");
    return NextResponse.json({ settings: getRiskSettings(accountId) });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to read risk settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const validation = validateBody(updateSchema, await request.json());
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { accountId, ...updates } = validation.data;
    return NextResponse.json({
      settings: updateRiskSettings(accountId ?? null, updates),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to update risk settings" },
      { status: 500 }
    );
  }
}
