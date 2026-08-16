import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mobileApiAuthorized } from "@/lib/auth/mobile-api";
import { createMobileHostApplication } from "@/lib/db/repositories/mobile";
import { preparePrivateDocument } from "@/lib/security/documents";

export async function POST(request: Request) {
  if (!mobileApiAuthorized(request)) return new NextResponse("Unauthorized", { status: 401 });
  const formData = await request.formData();
  const parsed = z.object({ externalUserId: z.string().trim().min(1).max(80), legalName: z.string().trim().min(2).max(120), countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()), governmentIdType: z.string().trim().min(2).max(80), governmentIdLast4: z.string().trim().min(4).max(8), agencyCode: z.string().trim().max(32).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return NextResponse.json({ error: "Invalid host application", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const documents = [];
    for (const [field, type] of [["idFront", "GOVERNMENT_ID_FRONT"], ["idBack", "GOVERNMENT_ID_BACK"], ["profilePhoto", "PROFILE_PHOTO"]] as const) {
      const value = formData.get(field); if (value instanceof File && value.size) { const document = await preparePrivateDocument(value, randomUUID(), type); if (document) documents.push(document); }
    }
    if (!documents.some((document) => document.documentType === "GOVERNMENT_ID_FRONT")) return NextResponse.json({ error: "Government ID front is required" }, { status: 400 });
    return NextResponse.json({ id: await createMobileHostApplication({ ...parsed.data, documents }), status: "PENDING" }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Application failed" }, { status: 500 }); }
}
