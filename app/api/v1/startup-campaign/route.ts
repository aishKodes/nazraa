import { NextResponse } from "next/server";
import { getStartupCampaign } from "@/lib/db/repositories/startup-campaign";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ campaign: await getStartupCampaign() }, { headers: {"Cache-Control": "public, max-age=30"} }); }
  catch { return NextResponse.json({campaign: null}, {status: 503}); }
}
