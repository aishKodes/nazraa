import { NextResponse } from "next/server";
import { maintainSharedGameRounds } from "@/lib/db/repositories/mobile-product";
import {
  publishSharedGameRealtimeState,
  publishSharedGameSettlementInvalidation,
} from "@/lib/services/game-realtime-events";

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
    // Only publish after the transaction that inserted the settlement and
    // ledger entries committed. The round ID lets a client reconcile its
    // current result instead of presenting it on the following round.
    await Promise.all(
      result.settledRounds.map(({ game, roundId }) =>
        publishSharedGameSettlementInvalidation(game, roundId),
      ),
    );
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
