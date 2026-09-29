import { NextResponse } from "next/server";
import { pruneInactiveRooms } from "@/lib/db/repositories/mobile-product";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  try {
    await pruneInactiveRooms();
    return NextResponse.json({ status: "complete" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Room maintenance unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
