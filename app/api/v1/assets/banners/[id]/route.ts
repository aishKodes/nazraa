import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const [rows] = await db().query<(RowDataPacket & { mime_type: string; image_data: Buffer })[]>(
    "SELECT mime_type, image_data FROM banner_assets WHERE id = ? LIMIT 1",
    [id],
  );
  const asset = rows[0];
  if (!asset) return NextResponse.json({ error: "Banner image not found." }, { status: 404 });
  return new NextResponse(new Uint8Array(asset.image_data), {
    headers: {
      "Content-Type": asset.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
