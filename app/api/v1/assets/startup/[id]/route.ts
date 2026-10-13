import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { getStartupCampaign } from "@/lib/db/repositories/startup-campaign";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: {params: Promise<{id: string}>}) {
  const {id} = await context.params;
  const campaign = await getStartupCampaign();
  if (!campaign || campaign.assetId !== id) return new NextResponse(null, {status: 404});
  const [rows] = await db().query<RowDataPacket[]>("SELECT mime_type, image_data FROM startup_campaign_assets WHERE id = ?", [id]);
  if (!rows[0]) return new NextResponse(null, {status: 404});
  return new NextResponse(new Uint8Array(rows[0].image_data), {headers: {
    "Content-Type": String(rows[0].mime_type), "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable", ETag: `"${campaign.checksum}"`,
  }});
}
