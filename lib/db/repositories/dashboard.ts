import "server-only";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { DashboardMetrics, LedgerEntry, PageRequest, PageResult, Scope } from "@/types/platform";

type ActivityRow = RowDataPacket & { id: string; action: string; module: string; actor_name: string | null; created_at: string };
type LedgerRow = RowDataPacket & {
  id: string; transaction_code: string; asset_type: LedgerEntry["assetType"]; transaction_type: string;
  source_name: string | null; destination_name: string | null; amount: number; status: string; created_at: string;
};

function ledgerVisibility(scope: Scope) {
  if (scope.isGlobal) return { clause: "1=1", values: [] as string[] };
  const filters = ["l.actor_account_id", "src_account.id", "dest_account.id", "src_user.agency_account_id", "dest_user.agency_account_id"].map((column) => scopeWhere(scope, column));
  return { clause: `(${filters.map((filter) => filter.clause).join(" OR ")})`, values: filters.flatMap((filter) => filter.values) };
}

export async function getDashboardMetrics(scope: Scope): Promise<DashboardMetrics> {
  const users = scopeWhere(scope, "agency_account_id");
  const hosts = scopeWhere(scope, "agency_account_id");
  const rooms = scopeWhere(scope, "agency_account_id");
  const withdrawals = scopeWhere(scope, "agency_account_id");
  const accountIds = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "id");
  const ledger = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "actor_account_id");
  const inventory = { clause: "owner_id = ?", values: [scope.account.id] };
  const [rows] = await db().query<(RowDataPacket & {
    users: number; hosts: number; agencies: number; active_rooms: number; revenue: number;
    pending_withdrawals: number; coin_inventory: number;
  })[]>(
    `SELECT
       (SELECT COUNT(*) FROM application_users WHERE ${users.clause}) users,
       (SELECT COUNT(*) FROM host_profiles WHERE ${hosts.clause} AND status IN ('APPROVED','ACTIVE')) hosts,
       (SELECT COUNT(*) FROM platform_accounts WHERE ${accountIds.clause} AND role = 'AGENCY' AND status = 'ACTIVE') agencies,
       (SELECT COUNT(*) FROM live_rooms WHERE ${rooms.clause} AND status = 'ACTIVE') active_rooms,
       (SELECT COALESCE(SUM(money_amount), 0) FROM ledger_transactions WHERE ${ledger.clause} AND asset_type = 'CASH' AND status = 'COMPLETED') revenue,
       (SELECT COUNT(*) FROM withdrawal_requests WHERE ${withdrawals.clause} AND status IN ('PENDING','UNDER_REVIEW')) pending_withdrawals,
       (SELECT COALESCE(SUM(available_balance), 0) FROM wallet_balances WHERE owner_type = 'PLATFORM_ACCOUNT' AND ${inventory.clause} AND asset_type = 'COIN') coin_inventory`,
    [...users.values, ...hosts.values, ...accountIds.values, ...rooms.values, ...ledger.values, ...withdrawals.values, ...inventory.values],
  );
  const row = rows[0];
  return {
    users: Number(row?.users ?? 0), hosts: Number(row?.hosts ?? 0), agencies: Number(row?.agencies ?? 0),
    activeRooms: Number(row?.active_rooms ?? 0), revenue: Number(row?.revenue ?? 0),
    pendingWithdrawals: Number(row?.pending_withdrawals ?? 0), coinInventory: Number(row?.coin_inventory ?? 0),
  };
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
  const filter = ledgerVisibility(scope);
  const [rows] = await db().query<LedgerRow[]>(
    `SELECT l.id, l.transaction_code, l.asset_type, l.transaction_type, l.amount, l.status, l.created_at,
            COALESCE(src_account.full_name, src_user.full_name) source_name,
            COALESCE(dest_account.full_name, dest_user.full_name) destination_name
     FROM ledger_transactions l
     LEFT JOIN platform_accounts src_account ON l.source_type = 'PLATFORM_ACCOUNT' AND src_account.id = l.source_id
     LEFT JOIN application_users src_user ON l.source_type = 'APPLICATION_USER' AND src_user.id = l.source_id
     LEFT JOIN platform_accounts dest_account ON l.destination_type = 'PLATFORM_ACCOUNT' AND dest_account.id = l.destination_id
     LEFT JOIN application_users dest_user ON l.destination_type = 'APPLICATION_USER' AND dest_user.id = l.destination_id
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

export async function getLedgerPage(scope: Scope, input: PageRequest = {}): Promise<PageResult<LedgerEntry>> {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(10, Math.trunc(input.pageSize ?? 25)));
  const filter = ledgerVisibility(scope);
  const [rows] = await db().query<LedgerRow[]>(
    `SELECT l.id, l.transaction_code, l.asset_type, l.transaction_type, l.amount, l.status, l.created_at,
            COALESCE(src_account.full_name, src_user.full_name) source_name,
            COALESCE(dest_account.full_name, dest_user.full_name) destination_name
     FROM ledger_transactions l
     LEFT JOIN platform_accounts src_account ON l.source_type = 'PLATFORM_ACCOUNT' AND src_account.id = l.source_id
     LEFT JOIN application_users src_user ON l.source_type = 'APPLICATION_USER' AND src_user.id = l.source_id
     LEFT JOIN platform_accounts dest_account ON l.destination_type = 'PLATFORM_ACCOUNT' AND dest_account.id = l.destination_id
     LEFT JOIN application_users dest_user ON l.destination_type = 'APPLICATION_USER' AND dest_user.id = l.destination_id
     WHERE ${filter.clause} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    [...filter.values, pageSize + 1, (page - 1) * pageSize],
  );
  const items = rows.slice(0, pageSize).map((row) => ({
    id: row.id, transactionCode: row.transaction_code, assetType: row.asset_type,
    transactionType: row.transaction_type, sourceName: row.source_name ?? "Platform",
    destinationName: row.destination_name ?? "—", amount: Number(row.amount), status: row.status, createdAt: row.created_at,
  }));
  return { items, page, pageSize, hasNext: rows.length > pageSize };
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
