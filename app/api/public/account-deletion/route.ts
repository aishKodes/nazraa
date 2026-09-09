import { NextResponse } from "next/server";
import { z } from "zod";
import { createWebDeletionRequest } from "@/lib/db/repositories/mobile-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = z.object({ email: z.string().trim().email().max(190), publicId: z.string().trim().regex(/^\d{6,12}$/), message: z.string().trim().max(500).optional() }).parse(await request.json());
    return NextResponse.json(await createWebDeletionRequest(input), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Public account deletion initiation failed", error);
    return NextResponse.json({ message: "We couldn't submit this deletion request. Please try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
