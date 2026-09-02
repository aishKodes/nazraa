import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { agencyWithdrawalCsv } from "@/lib/db/repositories/withdrawal-finance";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const account = await getSession();
  if (!account || account.role !== "MASTER") return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await context.params;
  try {
    const csv = await agencyWithdrawalCsv(await scopeFor(account), id);
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nazraa-agency-${id}-withdrawals.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Report could not be created." }, { status: 400 });
  }
}
