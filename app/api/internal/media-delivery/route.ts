import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { roomMediaDeliveryDiagnostics } from "@/lib/db/repositories/mobile-completion";

export const dynamic = "force-dynamic";

/** Master diagnostics only. No ZEGO secret, signed URL or provider endpoint is returned. */
export async function GET(request: Request) {
  const account = await getSession();
  if (!account || !can(account.role, "settings.manage")) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const roomCode = new URL(request.url).searchParams.get("roomCode")?.trim() ?? "";
  if (!/^[A-Z0-9_-]{3,80}$/i.test(roomCode)) {
    return NextResponse.json({ error: "A valid room code is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const diagnostic = await roomMediaDeliveryDiagnostics(roomCode);
  if (!diagnostic) {
    return NextResponse.json({ error: "Room not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(diagnostic, { headers: { "Cache-Control": "private, no-store" } });
}
