import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor, scopeWhere } from "@/lib/db/repositories/accounts";
import { db } from "@/lib/db/pool";
import { decryptPrivateText } from "@/lib/security/documents";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await getSession();
  if (!account || !can(account.role, "withdrawals.review")) return new NextResponse("Unauthorized", { status: 401 });
  const scope = await scopeFor(account); const filter = scopeWhere(scope, "user.agency_account_id"); const { id } = await params;
  const [rows] = await db().query<(RowDataPacket & { display_name: string; method_type: string; encrypted_data: Buffer | null; encryption_iv: Buffer | null; encryption_tag: Buffer | null })[]>(
    `SELECT method.display_name, method.method_type, method.destination_encrypted encrypted_data,
            method.destination_iv encryption_iv, method.destination_tag encryption_tag
     FROM payout_methods method INNER JOIN application_users user ON user.id = method.application_user_id
     WHERE method.id = ? AND ${filter.clause} LIMIT 1`,
    [id, ...filter.values],
  );
  const method = rows[0];
  if (!method) return new NextResponse("Not found", { status: 404 });
  if (!method.encrypted_data || !method.encryption_iv || !method.encryption_tag) return new NextResponse("Legacy payout destination is unavailable.", { status: 409 });
  const destination = decryptPrivateText({ encryptedData: method.encrypted_data, iv: method.encryption_iv, tag: method.encryption_tag });
  return new NextResponse(`${method.display_name}\n${method.method_type}\n${destination}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "inline", "Cache-Control": "private, no-store" } });
}
