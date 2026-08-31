import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { db } from "@/lib/db/pool";
import { decryptPrivateDocument, decryptPrivateText } from "@/lib/security/documents";

export const dynamic = "force-dynamic";

type KycRow = RowDataPacket & {
  parent_account_id: string | null;
  pan_encrypted: Buffer | null;
  pan_iv: Buffer | null;
  pan_tag: Buffer | null;
  aadhaar_encrypted: Buffer | null;
  aadhaar_iv: Buffer | null;
  aadhaar_tag: Buffer | null;
  document_original_name: string | null;
  document_mime_type: string | null;
  document_encrypted_data: Buffer | null;
  document_encryption_iv: Buffer | null;
  document_encryption_tag: Buffer | null;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const account = await getSession();
  if (!account || !can(account.role, "documents.read")) return new NextResponse("Unauthorized", { status: 401 });
  const scope = await scopeFor(account);
  const { id, kind } = await params;
  if (!["pan", "aadhaar", "document", "document-1", "document-2", "document-3"].includes(kind)) return new NextResponse("Not found", { status: 404 });
  const [rows] = await db().query<KycRow[]>(
    `SELECT parent_account_id, pan_encrypted, pan_iv, pan_tag, aadhaar_encrypted, aadhaar_iv, aadhaar_tag,
            document_original_name, document_mime_type, document_encrypted_data, document_encryption_iv, document_encryption_tag
     FROM agency_creation_applications WHERE id = ? LIMIT 1`, [id],
  );
  const application = rows[0];
  if (!application) return new NextResponse("Not found", { status: 404 });
  if (!scope.isGlobal && (!application.parent_account_id || !scope.accountIds.includes(application.parent_account_id))) return new NextResponse("Forbidden", { status: 403 });
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (kind.startsWith("document-")) {
    const [documents] = await db().query<RowDataPacket[]>("SELECT original_name, mime_type, encrypted_data, encryption_iv, encryption_tag FROM agency_application_documents WHERE application_id = ? AND slot = ? LIMIT 1", [id, Number(kind.slice(-1))]);
    const document = documents[0];
    if (!document) return new NextResponse("Not found", { status: 404 });
    const plain = decryptPrivateDocument({ encryptedData: document.encrypted_data, iv: document.encryption_iv, tag: document.encryption_tag });
    return new NextResponse(new Uint8Array(plain), { headers: { ...headers, "Content-Type": document.mime_type, "Content-Disposition": `attachment; filename="document-${kind.slice(-1)}.${document.mime_type === 'image/png' ? 'png' : 'jpg'}"` } });
  }
  if (kind === "document") {
    if (!application.document_encrypted_data || !application.document_encryption_iv || !application.document_encryption_tag) return new NextResponse("Not found", { status: 404 });
    const plain = decryptPrivateDocument({ encryptedData: application.document_encrypted_data, iv: application.document_encryption_iv, tag: application.document_encryption_tag });
    const name = (application.document_original_name ?? "agency-proof").replaceAll('"', "");
    return new NextResponse(new Uint8Array(plain), { headers: { ...headers, "Content-Type": application.document_mime_type ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"` } });
  }
  const encryptedData = kind === "pan" ? application.pan_encrypted : application.aadhaar_encrypted;
  const iv = kind === "pan" ? application.pan_iv : application.aadhaar_iv;
  const tag = kind === "pan" ? application.pan_tag : application.aadhaar_tag;
  if (!encryptedData || !iv || !tag) return new NextResponse("Not found", { status: 404 });
  const value = decryptPrivateText({ encryptedData, iv, tag });
  return new NextResponse(value, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="agency-${kind}.txt"` } });
}
