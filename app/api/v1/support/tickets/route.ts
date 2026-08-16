import { NextResponse } from "next/server";
import { z } from "zod";
import { mobileApiAuthorized } from "@/lib/auth/mobile-api";
import { createMobileSupportTicket } from "@/lib/db/repositories/mobile";

export async function POST(request: Request) {
  if (!mobileApiAuthorized(request)) return new NextResponse("Unauthorized", { status: 401 });
  const parsed = z.object({ externalUserId: z.string().trim().min(1).max(80), subject: z.string().trim().min(3).max(160), category: z.string().trim().min(2).max(60), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), message: z.string().trim().min(2).max(2000) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid ticket", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  try { return NextResponse.json(await createMobileSupportTicket(parsed.data), { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Ticket failed" }, { status: 500 }); }
}
