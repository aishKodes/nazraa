import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { getPlatformAccountDetail } from "@/lib/db/repositories/administration";
import { listHostsPage } from "@/lib/db/repositories/directory";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await getSession();
  if (!account || !can(account.role, "hierarchy.read")) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const scope = await scopeFor(account);
  const { id } = await params;
  const agency = await getPlatformAccountDetail(scope, id);
  if (!agency || agency.role !== "AGENCY") return NextResponse.json({ error: "Agency not found in your branch" }, { status: 404 });
  const page = Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1);
  const result = await listHostsPage({ account, accountIds: [id], isGlobal: false }, { page });
  return NextResponse.json({ page: result.page, hasNext: result.hasNext, nodes: result.items.map((host) => ({
    id: `host:${host.id}`, role: "HOST", code: host.externalUserId, name: host.fullName, parentId: id,
    status: host.status, detailHref: `/dashboard/hosts/${host.id}`, hostCount: 1,
    liveMinutes: host.liveMinutes, sessions: host.sessions, giftValue: host.gifts,
  })) }, { headers: { "Cache-Control": "private, no-store" } });
}
