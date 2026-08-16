import "server-only";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { DashboardMetrics, LedgerEntry, Scope } from "@/types/platform";

type NumberRow = RowDataPacket & { value: number };
type ActivityRow = RowDataPacket & { id: string; action: string; module: string; actor_name: string | null; created_at: string };
type LedgerRow = RowDataPacket & {
  id: string; transaction_code: string; asset_type: LedgerEntry["assetType"]; transaction_type: string;
  source_name: string | null; destination_name: string | null; amount: number; status: string; created_at: string;
};

async function count(query: string, values: unknown[] = []) {
  const [rows] = await db().query<NumberRow[]>(query, values);
  return Number(rows[0]?.value ?? 0);
}

function agencyFilter(scope: Scope, column: string) {
  return scopeWhere(scope, column);
}

export async function getDashboardMetrics(scope: Scope): Promise<DashboardMetrics> {
  const accountFilter = agencyFilter(scope, "agency_account_id");
  const hostFilter = agencyFilter(scope, "h.agency_account_id");
  const roomFilter = agencyFilter(scope, "agency_account_id");
  const withdrawalFilter = agencyFilter(scope, "agency_account_id");

  const [users, hosts, agencies, activeRooms, revenue, pendingWithdrawals, inventory] = await Promise.all([
    count(`SELECT COUNT(*) value FROM application_users WHERE ${accountFilter.clause}`, accountFilter.values),
    count(`SELECT COUNT(*) value FROM host_profiles h WHERE ${hostFilter.clause} AND h.status IN ('APPROVED','ACTIVE')`, hostFilter.values),
    scope.isGlobal ? count("SELECT COUNT(*) value FROM platform_accounts WHERE role = 'AGENCY' AND status = 'ACTIVE'") : count(`SELECT COUNT(*) value FROM platform_accounts WHERE role = 'AGENCY' AND id IN (${scope.accountIds.map(() => "?").join(",")})`, scope.accountIds),
    count(`SELECT COUNT(*) value FROM live_rooms WHERE ${roomFilter.clause} AND status = 'ACTIVE'`, roomFilter.values),
    count(`SELECT COALESCE(SUM(money_amount), 0) value FROM ledger_transactions WHERE ${scope.isGlobal ? "1=1" : `actor_account_id IN (${scope.accountIds.map(() => "?").join(",")})`} AND asset_type = 'CASH' AND status = 'COMPLETED'`, scope.isGlobal ? [] : scope.accountIds),
    count(`SELECT COUNT(*) value FROM withdrawal_requests WHERE ${withdrawalFilter.clause} AND status IN ('PENDING','UNDER_REVIEW')`, withdrawalFilter.values),
    count(`SELECT COALESCE(SUM(available_balance), 0) value FROM wallet_balances WHERE owner_type = 'PLATFORM_ACCOUNT' AND owner_id ${scope.isGlobal ? "IS NOT NULL" : `IN (${scope.accountIds.map(() => "?").join(",")})`} AND asset_type = 'COIN'`, scope.isGlobal ? [] : scope.accountIds),
  ]);
  return { users, hosts, agencies, activeRooms, revenue, pendingWithdrawals, coinInventory: inventory };
}

export async function getRecentActivity(scope: Scope) {
  const filter = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.actor_account_id");
  const [rows] = await db().query<ActivityRow[]>(
    `SELECT a.id, a.action, a.module, p.full_name actor_name, a.created_at
     FROM audit_logs a LEFT JOIN platform_accounts p ON p.id = a.actor_account_id
     WHERE ${filter.clause} ORDER BY a.created_at DESC LIMIT 8`,
    filter.values,
  );
  return rows.map((row) => ({ id: row.id, action: row.action, module: row.module, actorName: row.actor_name ?? "System", createdAt: row.created_at }));
}

export async function getRecentLedger(scope: Scope, limit = 12): Promise<LedgerEntry[]> {
  const filter = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "l.actor_account_id");
  const [rows] = await db().query<LedgerRow[]>(
    `SELECT l.id, l.transaction_code, l.asset_type, l.transaction_type, l.amount, l.status, l.created_at,
            src.full_name source_name, dest.full_name destination_name
     FROM ledger_transactions l
     LEFT JOIN platform_accounts src ON src.id = l.source_id
     LEFT JOIN application_users dest ON dest.id = l.destination_id
     WHERE ${filter.clause} ORDER BY l.created_at DESC LIMIT ?`,
    [...filter.values, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    transactionCode: row.transaction_code,
    assetType: row.asset_type,
    transactionType: row.transaction_type,
    sourceName: row.source_name ?? "Platform",
    destinationName: row.destination_name ?? "—",
    amount: Number(row.amount),
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function getRevenueSeries(scope: Scope) {
  const filter = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "actor_account_id");
  const [rows] = await db().query<(RowDataPacket & { day: string; revenue: number; payouts: number })[]>(
    `SELECT DATE(created_at) day,
            SUM(CASE WHEN asset_type = 'CASH' AND money_amount > 0 THEN money_amount ELSE 0 END) revenue,
            SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN money_amount ELSE 0 END) payouts
     FROM ledger_transactions WHERE ${filter.clause} AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(created_at) ORDER BY day`,
    filter.values,
  );
  return rows.map((row) => ({ day: row.day, revenue: Number(row.revenue ?? 0), payouts: Number(row.payouts ?? 0) }));
}
