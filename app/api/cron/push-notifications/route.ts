import { NextResponse } from "next/server";
import { processPendingPushNotifications } from "@/lib/services/fcm-push-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    return NextResponse.json(await processPendingPushNotifications());
  } catch {
    return NextResponse.json({ message: "Unavailable" }, { status: 503 });
  }
}
