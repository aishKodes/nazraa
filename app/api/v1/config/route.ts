import { NextResponse } from "next/server";
import { publicMobileConfig } from "@/lib/db/repositories/mobile";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await publicMobileConfig(), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }); }
  catch { return NextResponse.json({ gifts: [], banners: [], notifications: [], settings: {} }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
