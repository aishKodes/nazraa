import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor, scopeWhere } from "@/lib/db/repositories/accounts";
import { getHostDetail } from "@/lib/db/repositories/hosts";
import { db } from "@/lib/db/pool";
import { decryptPrivateDocument } from "@/lib/security/documents";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await getSession();
  if (!account || !can(account.role, "documents.read")) return new NextResponse("Unauthorized", { status: 401 });
  const scope = await scopeFor(account); const { id } = await params;
  const [rows] = await db().query<(RowDataPacket & { owner_type: string; owner_id: string; original_name: string; mime_type: string; encrypted_data: Buffer; encryption_iv: Buffer; encryption_tag: Buffer })[]>(
    `SELECT owner_type, owner_id, original_name, mime_type, encrypted_data, encryption_iv, encryption_tag FROM private_documents WHERE id = ? LIMIT 1`, [id],
  );
  const document = rows[0];
  if (!document) return new NextResponse("Not found", { status: 404 });
  let permitted = false;
  if (document.owner_type === "HOST_APPLICATION") permitted = Boolean(await getHostDetail(scope, document.owner_id));
  else if (document.owner_type === "FACE_VERIFICATION" && can(account.role, "face_verification.read")) {
    const filter = scopeWhere(scope, "user.agency_account_id");
    const [requests] = await db().query<RowDataPacket[]>(
      `SELECT request.id FROM face_verification_requests request
       INNER JOIN application_users user ON user.id = request.application_user_id
       WHERE request.id = ? AND ${filter.clause} LIMIT 1`,
      [document.owner_id, ...filter.values],
    );
    permitted = Boolean(requests[0]);
  } else permitted = scope.isGlobal || document.owner_id === account.id || scope.accountIds.includes(document.owner_id);
  if (!permitted) return new NextResponse("Forbidden", { status: 403 });
  const plain = decryptPrivateDocument({ encryptedData: document.encrypted_data, iv: document.encryption_iv, tag: document.encryption_tag });
  return new NextResponse(new Uint8Array(plain), { headers: { "Content-Type": document.mime_type, "Content-Disposition": `attachment; filename="${document.original_name.replaceAll('"', "")}"`, "Cache-Control": "private, no-store" } });
}
