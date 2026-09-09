import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const assetId = id.replace(/\.(?:json|webp|mp4|webm|mp3|ogg|m4a)$/i, "");
  const [rows] = await db().query<(RowDataPacket & { mime_type: string; image_data: Buffer; byte_size: number })[]>(
    `SELECT asset.mime_type, asset.image_data, asset.byte_size FROM gift_assets asset
     INNER JOIN gift_catalog gift ON gift.active = TRUE AND (
       gift.visual_url LIKE CONCAT('%/', asset.id)
       OR gift.animation_key LIKE CONCAT('%/', asset.id, '.%')
       OR CAST(gift.asset_config AS CHAR) LIKE CONCAT('%/', asset.id, '.%')
     )
     WHERE asset.id = ? LIMIT 1`,
    [assetId],
  );
  const asset = rows[0];
  if (!asset) return NextResponse.json({ error: "Gift artwork not found." }, { status: 404 });
  const full = asset.image_data;
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/i);
  const start = range && range[1] ? Number(range[1]) : 0;
  const requestedEnd = range && range[2] ? Number(range[2]) : full.length - 1;
  const end = Math.min(requestedEnd, full.length - 1);
  if (range && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= full.length)) {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${full.length}` } });
  }
  const body = range ? full.subarray(start, end + 1) : full;
  return new NextResponse(new Uint8Array(body), {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": asset.mime_type,
      "Content-Length": String(body.length),
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${full.length}` } : {}),
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
