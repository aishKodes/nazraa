import { NextResponse } from "next/server";
import { runMonthlyHostEarningsReset } from "@/lib/db/repositories/monthly-host-reset";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  try {
    return NextResponse.json(await runMonthlyHostEarningsReset(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Monthly reset failed." }, { status: 503 });
  }
}

