import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { permanentlyBanUser, permanentlyUnbanUser } from "@/lib/db/repositories/operations";
import { suspendFaceLiveAndStopMedia } from "@/lib/services/face-live-moderation";

export async function POST(request: Request) {
  const account = await getSession();
  if (!account) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || !["https://nazralive.in", "https://api.nazraa.pixtra.site"].includes(origin))
    return NextResponse.json({ error: "This request is not permitted." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const permission = action === "SUSPEND_FACE" ? "face_live.suspend" : "users.permanent";
  if (!can(account.role, permission) || (permission === "users.permanent" && account.role !== "MASTER"))
    return NextResponse.json({ error: "Your role cannot perform this action." }, { status: 403 });
  const common = { applicationUserId: z.string().uuid(), reason: z.string().trim().min(5).max(500), confirmed: z.literal(true) };
  const parsed = z.discriminatedUnion("action", [
    z.object({ ...common, action: z.literal("BAN") }).strict(),
    z.object({ ...common, action: z.literal("UNBAN") }).strict(),
    z.object({ ...common, action: z.literal("SUSPEND_FACE"), durationMinutes: z.union([z.literal(30), z.literal(120)]) }).strict(),
  ]).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a supported action, duration and confirmation." }, { status: 400 });
  const scope = await scopeFor(account);
  try {
    const result = parsed.data.action === "SUSPEND_FACE"
      ? await suspendFaceLiveAndStopMedia({ scope, ...parsed.data })
      : await (parsed.data.action === "BAN" ? permanentlyBanUser : permanentlyUnbanUser)({ scope, ...parsed.data });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error && !("code" in error) ? error.message : "The action could not be completed. Please retry.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
