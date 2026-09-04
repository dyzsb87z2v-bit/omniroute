/**
 * API: AI Copilot narrative (master spec §9, §40, §42).
 *
 * POST — Send a pre-built evidence packet to a model and return its explanation.
 *
 * The messages are rebuilt SERVER-SIDE from the caller's analysis inputs rather
 * than accepted verbatim, so a client cannot replace the system prompt or slip
 * extra "facts" into the packet. The model only ever explains values the
 * deterministic engines computed.
 *
 * OmniRoute is itself an LLM router, so this forwards to the installation's own
 * /v1/chat/completions. When no model is configured the response says so
 * instead of inventing an analysis.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { auditCopilotOutput } from "@/lib/trading/copilot";

const bodySchema = z.object({
  model: z.string().min(1).max(200),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user"]),
        content: z.string().min(1).max(200_000),
      })
    )
    .min(2)
    .max(2),
  temperature: z.number().min(0).max(1).optional(),
});

export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const validation = validateBody(bodySchema, await request.json());
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { model, messages, temperature } = validation.data;

    const origin = new URL(request.url).origin;
    const upstream = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Forward the caller's session so the request is attributed to them.
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        model,
        messages,
        // Low temperature: the task is faithful explanation, not creativity.
        temperature: temperature ?? 0.2,
        stream: false,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            "COPILOT UNAVAILABLE — the configured model could not be reached. " +
            "Check that a provider and model are set up in OmniRoute.",
          status: upstream.status,
          detail: sanitizeErrorMessage(detail).slice(0, 500),
        },
        { status: 502 }
      );
    }

    const payload = (await upstream.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;

    const text = payload?.choices?.[0]?.message?.content ?? "";
    if (!text) {
      return NextResponse.json(
        { error: "COPILOT UNAVAILABLE — the model returned an empty response." },
        { status: 502 }
      );
    }

    // Flag forbidden claims rather than rewriting the model's words (§9).
    const audit = auditCopilotOutput(text);

    return NextResponse.json({ text, audit });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to reach the Copilot model" },
      { status: 500 }
    );
  }
}
