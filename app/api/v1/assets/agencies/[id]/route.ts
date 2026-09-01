import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

// Logos are public artwork. Identity documents are never served by this route.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(?:\d{6}|[a-f0-9-]{36})$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT application.logo_mime_type, application.logo_data FROM agency_creation_applications application
     LEFT JOIN platform_accounts agency ON agency.id = application.approved_agency_account_id
     WHERE (application.id = ? OR (agency.public_id = ? AND agency.status = 'ACTIVE'))
       AND application.logo_data IS NOT NULL LIMIT 1`, [id, /^\d{6}$/.test(id) ? id : null]);
  if (!rows[0]) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(rows[0].logo_data), { headers: {
    "Content-Type": String(rows[0].logo_mime_type), "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    "X-Content-Type-Options": "nosniff",
  } });
}
