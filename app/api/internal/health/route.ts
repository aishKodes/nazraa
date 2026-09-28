import { NextResponse } from "next/server";
import { db } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

/** Private deployment readiness probe. Never reveal database details. */
export async function GET() {
  try {
    await db().query("SELECT 1");
    return NextResponse.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
