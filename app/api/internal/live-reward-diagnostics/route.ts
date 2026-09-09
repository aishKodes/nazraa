import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getLiveRewardDiagnostics } from "@/lib/db/repositories/live-accounting-diagnostics";

export const dynamic = "force-dynamic";

/** Master-only aggregate diagnostic. This route deliberately returns no host,
 * session, room, wallet, credential, or media identifier. */
export async function GET(request: Request) {
  const account = await getSession();
  if (!account || account.role !== "MASTER") {
    return NextResponse.json({ message: "Not found." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const rawDays = new URL(request.url).searchParams.get("days") ?? "30";
  const days = Number(rawDays);
  try {
    return NextResponse.json(await getLiveRewardDiagnostics(days), {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ message: "Live reward diagnostics are temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
