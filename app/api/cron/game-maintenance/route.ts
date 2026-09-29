import { NextResponse } from "next/server";
import { maintainSharedGameRounds } from "@/lib/db/repositories/mobile-product";
import { publishSharedGameRealtimeState } from "@/lib/services/game-realtime-events";

export const dynamic = "force-dynamic";

/**
 * Private VPS-worker endpoint. It is deliberately not exposed through the
 * public Caddy routes: player requests only read current game state or place
 * their own idempotent bet; this worker settles matured rounds.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await maintainSharedGameRounds();
    await Promise.all(result.realtime.map(publishSharedGameRealtimeState));
    return NextResponse.json({
      settlements: result.settlements,
      totalSettlements: result.totalSettlements,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { message: "Game maintenance unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
