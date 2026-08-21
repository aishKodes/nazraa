import { NextResponse } from "next/server";
import { z } from "zod";
import { mobileApiAuthorized } from "@/lib/auth/mobile-api";
import { syncApplicationUser } from "@/lib/db/repositories/mobile";

export async function POST(request: Request) {
  if (!mobileApiAuthorized(request)) return new NextResponse("Unauthorized", { status: 401 });
  const parsed = z.object({
    externalUserId: z.string().trim().min(1).max(80),
    fullName: z.string().trim().min(2).max(120),
    countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    avatarUrl: z.string().url().optional(),
  }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid user data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  try { return NextResponse.json({ id: await syncApplicationUser(parsed.data) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "User sync failed" }, { status: 500 }); }
}
