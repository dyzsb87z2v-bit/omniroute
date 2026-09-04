/**
 * API: Trading data-source status (master spec §42).
 *
 * GET — Report which provider kinds are configured. This is the endpoint the UI
 * calls before rendering anything market-dependent, so it can show
 * "DATA SOURCE UNAVAILABLE" instead of an empty chart that looks like a bug.
 */

import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { summarizeProviders } from "@/lib/trading/providers/registry";
import { listProviderConnections } from "@/lib/db/trading";

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const providers = summarizeProviders();
    const connections = listProviderConnections();

    return NextResponse.json({
      providers: providers.map((provider) => ({
        ...provider,
        available: provider.configured > 0,
        // Stored connections that reference this kind, with secrets never echoed.
        connections: connections
          .filter((connection) => connection.kind === provider.kind)
          .map((connection) => ({
            providerId: connection.providerId,
            label: connection.label,
            enabled: connection.enabled,
            tradingEnabled: connection.tradingEnabled,
            lastHealthAt: connection.lastHealthAt,
            lastHealthOk: connection.lastHealthOk,
            lastHealthMessage: connection.lastHealthMessage,
          })),
      })),
      // Live execution is off unless a broker connection explicitly enables it.
      liveTradingEnabled: connections.some(
        (connection) => connection.kind === "broker" && connection.tradingEnabled
      ),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to read trading provider status" },
      { status: 500 }
    );
  }
}
