import { NextResponse } from "next/server";
import { z } from "zod";
import { createPublicSupportRequest } from "@/lib/db/repositories/mobile-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = z.object({
      category: z.enum(["ACCOUNT", "VERIFICATION", "AGENCY", "PURCHASE", "SAFETY", "PRIVACY", "DELETION", "CHILD_SAFETY", "COPYRIGHT"]),
      email: z.string().trim().email().max(190), subject: z.string().trim().min(3).max(160), message: z.string().trim().min(10).max(2000),
    }).parse(await request.json());
    return NextResponse.json(await createPublicSupportRequest(input), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Public support request failed", error);
    return NextResponse.json({ message: "We couldn't submit this support request. Please try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
