import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { getRecentLedger } from "@/lib/db/repositories/dashboard";

export const dynamic = "force-dynamic";

function csvValue(value: string | number) {
  const content = String(value).replaceAll('"', '""');
  // Escape formula-like cells so an export cannot execute spreadsheet formulas when opened.
  const safe = /^[=+\-@]/.test(content) ? `'${content}` : content;
  return `"${safe}"`;
}

export async function GET() {
  const account = await getSession();
  if (!account || !can(account.role, "reports.export")) return new NextResponse("Unauthorized", { status: 401 });
  const ledger = await getRecentLedger(await scopeFor(account), 10_000);
  const headers = ["Transaction code", "Asset", "Type", "Source", "Destination", "Amount", "Status", "Created at"];
  const csv = [headers.map(csvValue).join(","), ...ledger.map((entry) => [entry.transactionCode, entry.assetType, entry.transactionType, entry.sourceName, entry.destinationName, entry.amount, entry.status, entry.createdAt].map(csvValue).join(","))].join("\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=nazraa-transactions.csv", "Cache-Control": "no-store" } });
}
