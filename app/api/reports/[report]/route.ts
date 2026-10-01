import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { agencyHostReport, coinTransferHistory, gameManagementReport, hierarchyReport, liveRewardReport, type ReportPageInput } from "@/lib/db/repositories/owner-reports";
import { exportRowDate, summarySheet, workbookBuffer } from "@/lib/reports/xlsx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function inputFrom(url: URL): ReportPageInput {
  const pageValue = Number(url.searchParams.get("page") ?? 1);
  const pageSizeValue = Number(url.searchParams.get("pageSize") ?? 25);
  const periodValue = url.searchParams.get("period");
  return {
    page: Number.isFinite(pageValue) ? pageValue : 1,
    pageSize: Number.isFinite(pageSizeValue) ? pageSizeValue : 25,
    q: url.searchParams.get("q") ?? "",
    status: url.searchParams.get("status") ?? "",
    role: url.searchParams.get("role") ?? "",
    period: periodValue === "24h" || periodValue === "custom" ? periodValue : "30d",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    mode: url.searchParams.get("mode") === "date" ? "date" : "24h",
    date: url.searchParams.get("date") ?? "",
  };
}

function errResponse(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "";
  const isLimit = rawMessage.startsWith("Filtered export exceeds") || rawMessage.startsWith("Filtered hierarchy exceeds");
  const isInput = rawMessage.startsWith("Choose a valid");
  const message = isLimit || isInput ? rawMessage : "The report could not be generated. Please retry or narrow the filters.";
  return NextResponse.json({ error: message }, { status: isLimit ? 413 : isInput ? 400 : 500, headers: { "Cache-Control": "no-store" } });
}

function xlsxResponse(bytes: Uint8Array, filename: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Response(buffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function GET(request: Request, context: { params: Promise<{ report: string }> }) {
  const account = await getSession();
  if (!account) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { report } = await context.params;
  if (report === "coin-transfers") {
    if (!can(account.role, "coins.transfer")) return NextResponse.json({ error: "Forbidden." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  } else if (report === "hierarchy") {
    if (!can(account.role, "hierarchy.read")) return NextResponse.json({ error: "Forbidden." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  } else if (!["agency-hosts", "live-rewards", "games"].includes(report) || !can(account.role, "reports.export")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (urlFormat(request) === "xlsx" && !can(account.role, "reports.export")) return NextResponse.json({ error: "Forbidden." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const scope = await scopeFor(account);
  const url = new URL(request.url);
  const input = inputFrom(url);
  const exportXlsx = url.searchParams.get("format") === "xlsx";
  try {
    if (report === "coin-transfers") {
      if (exportXlsx) return NextResponse.json({ error: "Coin Transfer History does not support export." }, { status: 400 });
      return NextResponse.json(await coinTransferHistory(scope, input), { headers: { "Cache-Control": "no-store" } });
    }
    if (report === "agency-hosts") {
      const data = await agencyHostReport(scope, input, exportXlsx);
      if (!exportXlsx) return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
      const bytes = await workbookBuffer("Nazraa Agency Host Report", [{
        name: "Hosts & Targets",
        headers: ["Agency ID", "Agency Name", "Admin ID", "Host ID", "Host External ID", "Host Name", "Joining Date (IST)", "Host Status", "Account Status", "Target Period", "Assigned Target", "Achieved Target", "Remaining Target", "Completion %", "Target Status"],
        rows: data.items.map((row) => [row.agencyId, row.agencyName, row.adminId, row.hostId, row.hostExternalId, row.hostName, exportRowDate(row.joiningDate), row.hostStatus, row.accountStatus, "Not configured", "Not configured", "Not configured", "Not configured", "Not configured", "Not configured"]),
      }]);
      return xlsxResponse(bytes, "nazraa-agency-host-report.xlsx");
    }
    if (report === "hierarchy") {
      const data = await hierarchyReport(scope, input, exportXlsx);
      if (!exportXlsx) return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
      const hostData = await agencyHostReport(scope, { ...input, q: "", status: "" }, true, data.includedAgencyIds);
      const bytes = await workbookBuffer("Nazraa Authorized Hierarchy Report", [
        { name: "Hierarchy", headers: ["ID", "Name", "Role", "Parent ID", "Admin ID", "Agency ID", "Total Agencies", "Total Hosts", "Active Hosts", "Inactive Hosts", "Pending Hosts", "Joining Date (IST)", "Status"], rows: data.items.map((row) => [row.id, row.name, row.role, row.parentId, row.adminId, row.agencyId, row.totalAgencies, row.totalHosts, row.activeHosts, row.inactiveHosts, row.pendingHosts, exportRowDate(row.joinedAt), row.status]) },
        { name: "Host Targets", headers: ["Agency ID", "Agency Name", "Admin ID", "Host ID", "Host Name", "Joining Date (IST)", "Assigned Target", "Achieved Target", "Remaining Target", "Completion %", "Target Status"], rows: hostData.items.map((row) => [row.agencyId, row.agencyName, row.adminId, row.hostId, row.hostName, exportRowDate(row.joiningDate), "Not configured", "Not configured", "Not configured", "Not configured", "Not configured"]) },
      ]);
      return xlsxResponse(bytes, "nazraa-hierarchy-report.xlsx");
    }
    if (report === "live-rewards") {
      const data = await liveRewardReport(scope, input, exportXlsx);
      if (!exportXlsx) return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
      const bytes = await workbookBuffer("Nazraa Live Reward Monitoring", [
        summarySheet(Object.entries(data.summary).map(([key, value]) => [key, value] as [string, number])),
        { name: "Live Sessions", headers: ["User ID", "Host ID", "User Name", "Agency ID", "Live Session ID", "Room Type", "Live Start (IST)", "Live End (IST)", "Exact Eligible Duration (seconds)", "Total Live Minutes", "Total Live Hours", "Reward Eligibility", "Live Reward Earned (Diamonds)", "Claim Status", "Claim Date/Time (IST)", "Reward Credit Status", "Gifting Received (Coins)", "Diamonds Received", "Accounting Status"], rows: data.items.map((row) => [row.userId, row.hostId, row.userName, row.agencyId, row.sessionId, row.roomType, exportRowDate(row.startedAt), exportRowDate(row.endedAt), row.eligibleSeconds, row.totalMinutes, row.totalHours, row.rewardEligibility, row.rewardDiamonds, row.claimStatus, exportRowDate(row.claimedAt), row.rewardCreditStatus, row.giftingCoins, row.diamondsReceived, row.accuracy]) },
      ]);
      return xlsxResponse(bytes, "nazraa-live-reward-monitoring.xlsx");
    }
    if (report === "games") {
      const data = await gameManagementReport(scope, input, exportXlsx);
      if (!exportXlsx) return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
      const bytes = await workbookBuffer("Nazraa Game Management", [
        { name: "User Game Summary", headers: ["User ID", "User Name", "Current Coin Balance", "Games Played", "Games Won", "Games Lost", "Coins Bet", "Coins Won", "Coins Lost", "Net Game Result"], rows: data.summary.map((row) => [row.userId, row.userName, row.currentCoinBalance, row.totalGamesPlayed, row.totalGamesWon, row.totalGamesLost, row.totalCoinsBet, row.totalCoinsWon, row.totalCoinsLost, row.netGameResult]) },
        { name: "Game History", headers: ["Date/Time (IST)", "Game Name", "Game/Round ID", "Wallet Coins Before", "Bet Amount", "Result", "Actual Payout", "Coin Deduction", "Coin Addition", "Winnings Deduction", "Wallet Coins After", "Transaction Status", "User ID", "User Name"], rows: data.items.map((row) => [exportRowDate(row.dateTime), row.gameName, row.roundId, row.walletBefore, row.betAmount, row.outcome, row.payout, row.coinDeduction, row.coinAddition, row.winningsDeduction, row.walletAfter, row.transactionStatus, row.userId, row.userName]) },
      ]);
      return xlsxResponse(bytes, "nazraa-game-management.xlsx");
    }
    return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  } catch (error) {
    return errResponse(error);
  }
}

function urlFormat(request: Request) {
  return new URL(request.url).searchParams.get("format");
}
