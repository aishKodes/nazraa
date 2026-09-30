import { NextResponse } from "next/server";
import { pruneInactiveRooms } from "@/lib/db/repositories/mobile-product";
import { pruneDisconnectedFaceGuests } from "@/lib/db/repositories/mobile-completion";
import { LiveKitRoomAdmin } from "@/lib/services/livekit-room-admin";
import { publishRoomRealtimeEvent } from "@/lib/services/room-realtime-events";
import { invalidateFaceLiveSocial } from "@/lib/db/repositories/face-live-social";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  try {
    await pruneInactiveRooms();
    const cleaned = await pruneDisconnectedFaceGuests();
    const media = new LiveKitRoomAdmin();
    for (const room of cleaned) {
      await Promise.all(room.publicIds.map(publicId => media.removeParticipant(room.roomCode, publicId)));
      await invalidateFaceLiveSocial(room.roomCode).catch(() => undefined);
      await publishRoomRealtimeEvent(room.roomCode, "seat");
    }
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
