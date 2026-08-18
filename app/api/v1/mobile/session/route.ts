import { NextResponse } from "next/server";
import { z } from "zod";
import { createMobileSession, revokeMobileSession } from "@/lib/auth/mobile-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(120),
    countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    avatarUrl: z.string().url().optional(),
    deviceLabel: z.string().trim().max(120).optional(),
  }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Check the profile details." }, { status: 400 });
  try {
    return NextResponse.json(await createMobileSession(parsed.data), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Session creation failed." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  await revokeMobileSession(request);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
