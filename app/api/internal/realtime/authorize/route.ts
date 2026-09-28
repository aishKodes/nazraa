import { timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { authenticateMobileRequest } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

function internalKeyMatches(supplied: string | null) {
  const expected = process.env.REALTIME_INTERNAL_SECRET;
  if (!expected || expected.length < 32 || !supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  // The route is additionally denied at the public Caddy edge. The shared
  // secret protects it if an edge rule is ever omitted or misconfigured.
  if (!internalKeyMatches(request.headers.get("x-nazraa-internal-key"))) {
    return new NextResponse(null, { status: 404 });
  }
  let roomCode: string;
  try {
    const body = await request.json();
    roomCode = String(body?.roomCode ?? "").trim();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(roomCode)) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    const identity = await authenticateMobileRequest(request);
    if (!identity) return new NextResponse(null, { status: 403 });
    const [rows] = await db().query<(RowDataPacket & { room_id: string })[]>(
      `SELECT room.id AS room_id
         FROM live_rooms room
         INNER JOIN live_room_members member
           ON member.room_id = room.id
          AND member.application_user_id = ?
          AND member.left_at IS NULL
        WHERE room.room_code = ?
          AND room.status IN ('ACTIVE', 'LOCKED')
        LIMIT 1`,
      [identity.userId, roomCode],
    );
    if (!rows[0]) return new NextResponse(null, { status: 403 });
    return NextResponse.json(
      { roomCode, roomId: rows[0].room_id, userId: identity.userId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
