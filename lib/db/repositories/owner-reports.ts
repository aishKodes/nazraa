import "server-only";

import type { RowDataPacket } from "mysql2";
import { db, withDatabaseReadRetry } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";

export type ReportPageInput = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  period?: "24h" | "30d" | "custom";
  from?: string;
  to?: string;
  date?: string;
  role?: string;
  mode?: "24h" | "date";
};

const PAGE_SIZE = 25;
export const REPORT_EXPORT_LIMIT = 20_000;
type BindValue = string | number | Date | boolean | null;

function pageArgs(input: ReportPageInput = {}) {
  const page = Math.max(1, Math.min(100_000, Math.trunc(Number(input.page) || 1)));
  const pageSize = Math.max(10, Math.min(50, Math.trunc(Number(input.pageSize) || PAGE_SIZE)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function queryText(input: ReportPageInput) {
  return String(input.q ?? "").trim().slice(0, 120);
}

function mysqlDate(value: Date) {
  return value.toISOString().slice(0, 23).replace("T", " ");
}

function istBoundary(date: string, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return null;
  if (nextDay) calendarDay.setUTCDate(calendarDay.getUTCDate() + 1);
  calendarDay.setUTCHours(0, 0, 0, 0);
  calendarDay.setTime(calendarDay.getTime() - 330 * 60_000);
  return mysqlDate(calendarDay);
}

function addRange(where: string[], values: BindValue[], column: string, input: ReportPageInput) {
  const period = input.period ?? "30d";
  if (period === "24h") {
    where.push(`${column} >= UTC_TIMESTAMP(3) - INTERVAL 24 HOUR AND ${column} <= UTC_TIMESTAMP(3)`);
  } else if (period === "30d") {
    where.push(`${column} >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY AND ${column} <= UTC_TIMESTAMP(3)`);
  } else if (period === "custom") {
    const start = input.from ? istBoundary(input.from) : null;
    const endExclusive = input.to ? istBoundary(input.to, true) : null;
    if (!start || !endExclusive || start > endExclusive) throw new Error("Choose a valid IST date range.");
    where.push(`${column} >= ? AND ${column} < ?`);
    values.push(start, endExclusive);
  }
}

function addUserSearch(where: string[], values: BindValue[], q: string, alias = "u") {
  if (!q) return;
  if (/^\d{1,12}$/.test(q)) {
    where.push(`(${alias}.public_id = ? OR ${alias}.external_user_id = ?)`);
    values.push(Number(q), q);
  } else {
    where.push(`${alias}.full_name LIKE ?`);
    values.push(`%${q}%`);
  }
}

export function formatIst(value: string | Date | null | undefined) {
  if (value == null) return "—";
  const date = value instanceof Date
    ? value
    : new Date(/^\d{4}-\d{2}-\d{2} \d/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(date) + " IST";
}

function noTargetFields<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    targetPeriod: null,
    assignedTarget: null,
    achievedTarget: null,
    remainingTarget: null,
    targetCompletionPercent: null,
    targetStatus: "NOT_CONFIGURED",
  };
}

export async function agencyHostReport(scope: Scope, input: ReportPageInput = {}, all = false, agencyIds?: string[]) {
  const { page, pageSize, offset } = pageArgs(input);
  const q = queryText(input);
  const scoped = scopeWhere(scope, "COALESCE(h.agency_account_id, u.agency_account_id)");
  const where = [scoped.clause];
  const values: BindValue[] = [...scoped.values];
  if (agencyIds !== undefined) {
    if (!agencyIds.length) where.push("1=0");
    else { where.push(`agency.public_id IN (${agencyIds.map(() => "?").join(",")})`); values.push(...agencyIds.map(Number)); }
  }
  if (q) {
    if (/^\d{1,12}$/.test(q)) {
      where.push("(u.public_id = ? OR u.external_user_id = ? OR agency.public_id = ?)");
      values.push(Number(q), q, Number(q));
    } else {
      where.push("(u.full_name LIKE ? OR agency.full_name LIKE ?)");
      values.push(`%${q}%`, `%${q}%`);
    }
  }
  if (input.status) { where.push("h.status = ?"); values.push(input.status.slice(0, 32)); }
  const filter = where.join(" AND ");
  const [countRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & { total: number; agencies: number })[]>(
    `SELECT COUNT(*) total, COUNT(DISTINCT COALESCE(h.agency_account_id, u.agency_account_id)) agencies
     FROM host_profiles h INNER JOIN application_users u ON u.id = h.application_user_id
     LEFT JOIN platform_accounts agency ON agency.id = COALESCE(h.agency_account_id, u.agency_account_id)
     WHERE ${filter}`,
    values,
  ));
  const count = Number(countRows[0]?.total ?? 0);
  if (all && count > REPORT_EXPORT_LIMIT) throw new Error(`Filtered export exceeds ${REPORT_EXPORT_LIMIT.toLocaleString()} rows. Narrow the filters first.`);
  const limit = all ? REPORT_EXPORT_LIMIT : pageSize;
  const [rows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT u.public_id host_public_id, u.external_user_id host_external_id, u.full_name host_name,
            u.created_at host_joined_at, u.account_status user_status,
            h.status host_status, h.verification_status,
            agency.public_id agency_public_id, agency.full_name agency_name,
            agency.country_code agency_country,
            parent.public_id direct_parent_public_id, parent.role direct_parent_role,
            grandparent.public_id grandparent_public_id,
            CASE WHEN parent.role IN ('ADMIN','BD') THEN parent.public_id
                 WHEN grandparent.role IN ('ADMIN','BD') THEN grandparent.public_id ELSE NULL END admin_public_id
     FROM host_profiles h
     INNER JOIN application_users u ON u.id = h.application_user_id
     LEFT JOIN platform_accounts agency ON agency.id = COALESCE(h.agency_account_id, u.agency_account_id)
     LEFT JOIN platform_accounts parent ON parent.id = agency.parent_account_id
     LEFT JOIN platform_accounts grandparent ON grandparent.id = parent.parent_account_id
     WHERE ${filter}
     ORDER BY agency.public_id, h.created_at DESC
     LIMIT ${limit + 1} OFFSET ${all ? 0 : offset}`,
    values,
  ));
  const items = rows.slice(0, limit).map((row) => noTargetFields({
    agencyId: row.agency_public_id == null ? null : String(row.agency_public_id),
    agencyName: row.agency_name == null ? null : String(row.agency_name),
    agencyCountry: row.agency_country == null ? null : String(row.agency_country),
    adminId: row.admin_public_id == null ? null : String(row.admin_public_id),
    hostId: String(row.host_public_id), hostExternalId: String(row.host_external_id),
    hostName: String(row.host_name), joiningDate: row.host_joined_at as string | Date,
    hostStatus: String(row.host_status), accountStatus: String(row.user_status),
  }));
  return {
    items, page, pageSize, total: count, hasNext: all ? false : offset + items.length < count,
    agencyCount: Number(countRows[0]?.agencies ?? 0), targetSourceAvailable: false,
  };
}

export async function hierarchyReport(scope: Scope, input: ReportPageInput = {}, all = false) {
  const q = queryText(input).toLowerCase();
  const authorized = scope.isGlobal
    ? { clause: "1=1", values: [] as string[] }
    : scopeWhere(scope, "account.id");
  const values: BindValue[] = [...authorized.values];
  const [accountRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT account.id, account.public_id, account.role, account.full_name, account.parent_account_id,
            account.status, account.country_code, account.created_at,
            parent.public_id parent_public_id, parent.role parent_role
     FROM platform_accounts account LEFT JOIN platform_accounts parent ON parent.id = account.parent_account_id
     WHERE ${authorized.clause} AND account.removed_at IS NULL ORDER BY account.created_at LIMIT ${REPORT_EXPORT_LIMIT + 1}`,
    values,
  ));
  if (accountRows.length > REPORT_EXPORT_LIMIT) throw new Error(`Filtered hierarchy exceeds ${REPORT_EXPORT_LIMIT.toLocaleString()} rows.`);
  const ids = accountRows.map((row) => String(row.id));
  const hostGroups = ids.length ? (await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT host.agency_account_id, COUNT(*) host_count,
            SUM(CASE WHEN host.status IN ('ACTIVE','APPROVED') THEN 1 ELSE 0 END) active_count,
            SUM(CASE WHEN host.status = 'PENDING' THEN 1 ELSE 0 END) pending_count,
            SUM(CASE WHEN host.status IN ('INACTIVE','SUSPENDED','REJECTED') THEN 1 ELSE 0 END) inactive_count
     FROM host_profiles host WHERE host.agency_account_id IN (${ids.map(() => "?").join(",")})
     GROUP BY host.agency_account_id`, ids,
  )))[0] : [];
  const direct = new Map(hostGroups.map((row) => [String(row.agency_account_id), {
    hosts: Number(row.host_count), active: Number(row.active_count), pending: Number(row.pending_count), inactive: Number(row.inactive_count), agencies: 0,
  }]));
  const nodes = accountRows.map((row) => ({
    internalId: String(row.id), id: String(row.public_id), name: String(row.full_name), role: String(row.role),
    parentInternalId: row.parent_account_id == null ? null : String(row.parent_account_id),
    parentId: row.parent_public_id == null ? null : String(row.parent_public_id),
    parentRole: row.parent_role == null ? null : String(row.parent_role), status: String(row.status),
    joinedAt: row.created_at as string | Date, country: row.country_code == null ? null : String(row.country_code),
  }));
  const byId = new Map(nodes.map((node) => [node.internalId, node]));
  const children = new Map<string, typeof nodes>();
  for (const node of nodes) if (node.parentInternalId) children.set(node.parentInternalId, [...(children.get(node.parentInternalId) ?? []), node]);
  const totals = new Map<string, { agencies: number; hosts: number; active: number; inactive: number; pending: number }>();
  function summarize(node: (typeof nodes)[number], seen = new Set<string>()) {
    const cached = totals.get(node.internalId);
    if (cached) return cached;
    if (seen.has(node.internalId)) return { agencies: 0, hosts: 0, active: 0, inactive: 0, pending: 0 };
    const path = new Set(seen).add(node.internalId);
    const own = direct.get(node.internalId) ?? { hosts: 0, active: 0, pending: 0, inactive: 0, agencies: 0 };
    const total = { agencies: own.agencies + (node.role === "AGENCY" ? 1 : 0), hosts: own.hosts, active: own.active, inactive: own.inactive, pending: own.pending };
    for (const child of children.get(node.internalId) ?? []) {
      const childTotal = summarize(child, path);
      total.agencies += childTotal.agencies; total.hosts += childTotal.hosts;
      total.active += childTotal.active; total.inactive += childTotal.inactive; total.pending += childTotal.pending;
    }
    totals.set(node.internalId, total);
    return total;
  }
  for (const node of nodes) summarize(node);
  function adminFor(node: (typeof nodes)[number]) {
    let parentId = node.parentInternalId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return null;
      if (parent.role === "ADMIN" || parent.role === "BD") return parent.id;
      parentId = parent.parentInternalId;
    }
    return null;
  }
  const filtered = nodes.filter((node) => {
    const matchesSearch = !q || [node.id, node.name, node.role, node.parentId].some((field) => String(field ?? "").toLowerCase().includes(q));
    return matchesSearch && (!input.status || node.status === input.status) && (!input.role || node.role === input.role);
  });
  const includedAgencyIds = new Set<string>();
  const visitedTreeNodes = new Set<string>();
  function includeDescendantAgencies(node: (typeof nodes)[number]) {
    if (visitedTreeNodes.has(node.internalId)) return;
    visitedTreeNodes.add(node.internalId);
    if (node.role === "AGENCY") includedAgencyIds.add(node.id);
    for (const child of children.get(node.internalId) ?? []) includeDescendantAgencies(child);
  }
  for (const node of filtered) includeDescendantAgencies(node);
  if (all && filtered.length > REPORT_EXPORT_LIMIT) throw new Error(`Filtered export exceeds ${REPORT_EXPORT_LIMIT.toLocaleString()} rows. Narrow the filters first.`);
  const { page, pageSize, offset } = pageArgs(input);
  const items = (all ? filtered : filtered.slice(offset, offset + pageSize)).map((node) => ({
    id: node.id, name: node.name, role: node.role, parentId: node.parentId, adminId: adminFor(node),
    agencyId: node.role === "AGENCY" ? node.id : null,
    totalAgencies: totals.get(node.internalId)?.agencies ?? 0,
    totalHosts: totals.get(node.internalId)?.hosts ?? 0,
    activeHosts: totals.get(node.internalId)?.active ?? 0,
    inactiveHosts: totals.get(node.internalId)?.inactive ?? 0,
    pendingHosts: totals.get(node.internalId)?.pending ?? 0,
    joinedAt: node.joinedAt, status: node.status, country: node.country,
  }));
  return { items, page, pageSize, total: filtered.length, hasNext: offset + items.length < filtered.length, includedAgencyIds: [...includedAgencyIds] };
}

type FilteredQuery = { whereSql: string; values: BindValue[] };

function liveFilters(scope: Scope, input: ReportPageInput): FilteredQuery {
  const scoped = scopeWhere(scope, "COALESCE(host.agency_account_id, user.agency_account_id, room.agency_account_id)");
  const where = [scoped.clause, "accounting.room_type IN ('LIVE','FACE')", "accounting.status != 'VOID'"];
  const values: BindValue[] = [...scoped.values];
  addRange(where, values, "accounting.started_at", input);
  addUserSearch(where, values, queryText(input), "user");
  return { whereSql: where.join(" AND "), values };
}

const liveSessionSelect = `
  SELECT accounting.id session_id, accounting.room_id, accounting.host_application_user_id,
         accounting.room_type, accounting.started_at, accounting.ended_at,
         accounting.valid_duration_seconds,
         COALESCE(accounting.eligible_seconds_committed, accounting.eligible_duration_seconds, 0) eligible_seconds,
         accounting.status session_status, accounting.accounting_accuracy,
         user.public_id user_public_id, user.external_user_id, user.full_name user_name,
         host.status host_status, agency.public_id agency_public_id,
         COALESCE(reward.reward_diamonds, 0) reward_diamonds,
         COALESCE(reward.claimed_diamonds, 0) claimed_diamonds,
         COALESCE(reward.pending_diamonds, 0) pending_diamonds,
         COALESCE(reward.credited_diamonds, 0) credited_diamonds,
         reward.claimed_at, COALESCE(decisions.eligible_hours, 0) eligible_hours,
         COALESCE(decisions.decision_count, 0) decision_count,
         COALESCE(gifts.gifting_coins, 0) gifting_coins,
         COALESCE(gifts.diamonds_received, 0) diamonds_received
  FROM live_session_accounting accounting
  INNER JOIN application_users user ON user.id = accounting.host_application_user_id
  LEFT JOIN host_profiles host ON host.application_user_id = user.id
  INNER JOIN live_rooms room ON room.id = accounting.room_id
  LEFT JOIN platform_accounts agency ON agency.id = COALESCE(host.agency_account_id, user.agency_account_id, room.agency_account_id)
  LEFT JOIN (
    SELECT entitlement.live_session_accounting_id,
           SUM(entitlement.amount) reward_diamonds,
           SUM(CASE WHEN entitlement.claim_status = 'CLAIMED' THEN entitlement.amount ELSE 0 END) claimed_diamonds,
           SUM(CASE WHEN entitlement.claim_status = 'UNCLAIMED' THEN entitlement.amount ELSE 0 END) pending_diamonds,
           SUM(CASE WHEN ledger.status = 'COMPLETED' THEN entitlement.amount ELSE 0 END) credited_diamonds,
           MAX(entitlement.claimed_at) claimed_at
    FROM live_reward_entitlements entitlement
    LEFT JOIN ledger_transactions ledger ON ledger.id = entitlement.ledger_transaction_id
    GROUP BY entitlement.live_session_accounting_id
  ) reward ON reward.live_session_accounting_id = accounting.id
  LEFT JOIN (
    SELECT live_session_accounting_id, COUNT(*) decision_count,
           SUM(CASE WHEN eligible = TRUE THEN 1 ELSE 0 END) eligible_hours
    FROM live_hour_reward_decisions GROUP BY live_session_accounting_id
  ) decisions ON decisions.live_session_accounting_id = accounting.id
  LEFT JOIN (
    SELECT live_session_id, SUM(coin_value * quantity) gifting_coins,
           SUM(diamond_value * quantity) diamonds_received
    FROM live_room_gift_events WHERE live_session_id IS NOT NULL GROUP BY live_session_id
  ) gifts ON gifts.live_session_id = accounting.id`;

function mapLive(row: RowDataPacket & Record<string, unknown>) {
  const eligibleSeconds = Number(row.eligible_seconds ?? 0);
  const status = Number(row.pending_diamonds) > 0 ? "CLAIMABLE" : Number(row.claimed_diamonds) > 0 ? "CLAIMED" : Number(row.eligible_hours) > 0 ? "REWARDED" : Number(row.decision_count) > 0 ? "NOT_ELIGIBLE" : "NOT_REACHED";
  return {
    sessionId: String(row.session_id), roomId: String(row.room_id), userId: String(row.user_public_id),
    hostId: String(row.external_user_id), userName: String(row.user_name), agencyId: row.agency_public_id == null ? null : String(row.agency_public_id),
    roomType: String(row.room_type), startedAt: row.started_at as string | Date,
    endedAt: row.ended_at as string | Date | null, sessionStatus: String(row.session_status), accuracy: String(row.accounting_accuracy ?? "UNSPECIFIED"),
    durationSeconds: Number(row.valid_duration_seconds ?? 0), eligibleSeconds,
    totalMinutes: Math.floor(eligibleSeconds / 60), totalHours: Number((eligibleSeconds / 3600).toFixed(2)),
    rewardEligibility: Number(row.eligible_hours) > 0 ? "ELIGIBLE" : Number(row.decision_count) > 0 ? "NOT_ELIGIBLE" : "NO_DECISION_RECORDED",
    rewardDiamonds: Number(row.reward_diamonds), claimStatus: status,
    claimedAt: row.claimed_at as string | Date | null,
    rewardCreditStatus: Number(row.credited_diamonds) > 0 ? "CREDITED" : Number(row.pending_diamonds) > 0 ? "NOT_CREDITED" : "—",
    giftingCoins: Number(row.gifting_coins), diamondsReceived: Number(row.diamonds_received),
  };
}

export async function liveRewardReport(scope: Scope, input: ReportPageInput = {}, all = false) {
  const filter = liveFilters(scope, input);
  const { page, pageSize, offset } = pageArgs(input);
  const [countRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) total FROM live_session_accounting accounting
     INNER JOIN application_users user ON user.id = accounting.host_application_user_id
     LEFT JOIN host_profiles host ON host.application_user_id = user.id
     INNER JOIN live_rooms room ON room.id = accounting.room_id
     WHERE ${filter.whereSql}`, filter.values,
  ));
  const total = Number(countRows[0]?.total ?? 0);
  if (all && total > REPORT_EXPORT_LIMIT) throw new Error(`Filtered export exceeds ${REPORT_EXPORT_LIMIT.toLocaleString()} rows. Narrow the filters first.`);
  const [summaryRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, number>)[]>(
    `SELECT COUNT(*) totalLiveSessions,
            COALESCE(SUM(COALESCE(accounting.eligible_seconds_committed, accounting.eligible_duration_seconds, 0)),0) totalLiveSeconds,
            COALESCE(SUM(reward.reward_diamonds),0) totalLiveRewards,
            COALESCE(SUM(reward.claimed_diamonds),0) totalClaimed,
            COALESCE(SUM(reward.pending_diamonds),0) totalPending,
            COALESCE(SUM(reward.credited_diamonds),0) totalCredited,
            COALESCE(SUM(gifts.gifting_coins),0) totalGiftingCoins,
            COALESCE(SUM(gifts.diamonds_received),0) totalDiamondsReceived
     FROM live_session_accounting accounting
     INNER JOIN application_users user ON user.id = accounting.host_application_user_id
     LEFT JOIN host_profiles host ON host.application_user_id = user.id
     INNER JOIN live_rooms room ON room.id = accounting.room_id
     LEFT JOIN (
       SELECT entitlement.live_session_accounting_id, SUM(entitlement.amount) reward_diamonds,
              SUM(CASE WHEN entitlement.claim_status = 'CLAIMED' THEN entitlement.amount ELSE 0 END) claimed_diamonds,
              SUM(CASE WHEN entitlement.claim_status = 'UNCLAIMED' THEN entitlement.amount ELSE 0 END) pending_diamonds,
              SUM(CASE WHEN ledger.status = 'COMPLETED' THEN entitlement.amount ELSE 0 END) credited_diamonds
       FROM live_reward_entitlements entitlement LEFT JOIN ledger_transactions ledger ON ledger.id = entitlement.ledger_transaction_id
       GROUP BY entitlement.live_session_accounting_id
     ) reward ON reward.live_session_accounting_id = accounting.id
     LEFT JOIN (
       SELECT live_session_id, SUM(coin_value * quantity) gifting_coins, SUM(diamond_value * quantity) diamonds_received
       FROM live_room_gift_events WHERE live_session_id IS NOT NULL GROUP BY live_session_id
     ) gifts ON gifts.live_session_id = accounting.id
     WHERE ${filter.whereSql}`, filter.values,
  ));
  const size = all ? REPORT_EXPORT_LIMIT : pageSize;
  const [rows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `${liveSessionSelect} WHERE ${filter.whereSql} ORDER BY accounting.started_at DESC LIMIT ${size + 1} OFFSET ${all ? 0 : offset}`,
    filter.values,
  ));
  const items = rows.slice(0, size).map(mapLive);
  const summary = summaryRows[0];
  const totalSeconds = Number(summary?.totalLiveSeconds ?? 0);
  return {
    items, page, pageSize, total, hasNext: all ? false : offset + items.length < total,
    summary: {
      totalLiveSessions: Number(summary?.totalLiveSessions ?? 0), totalLiveMinutes: Math.floor(totalSeconds / 60), totalLiveHours: Number((totalSeconds / 3600).toFixed(2)),
      totalLiveRewards: Number(summary?.totalLiveRewards ?? 0), totalClaimed: Number(summary?.totalClaimed ?? 0), totalPending: Number(summary?.totalPending ?? 0),
      totalCredited: Number(summary?.totalCredited ?? 0), totalGiftingCoins: Number(summary?.totalGiftingCoins ?? 0), totalDiamondsReceived: Number(summary?.totalDiamondsReceived ?? 0),
    },
  };
}

function mapGame(row: RowDataPacket & Record<string, unknown>) {
  const wager = Number(row.wager_total ?? 0);
  const payout = Number(row.payout_total ?? 0);
  const deduction = Number(row.deduction_total ?? 0);
  return {
    resultId: String(row.result_id), dateTime: row.created_at as string | Date,
    gameName: String(row.game_name), roundId: String(row.shared_round_id ?? row.client_round_id),
    walletBefore: Number(row.balance_after) + wager - payout,
    betAmount: wager, outcome: payout > wager ? "WIN" : payout < wager ? "LOSS" : "BREAK EVEN",
    payout, coinDeduction: wager, coinAddition: payout, winningsDeduction: deduction,
    walletAfter: Number(row.balance_after), transactionStatus: "COMPLETED",
    userId: String(row.public_id), userName: String(row.full_name),
  };
}

export async function gameManagementReport(scope: Scope, input: ReportPageInput = {}, all = false) {
  const { page, pageSize, offset } = pageArgs(input);
  const q = queryText(input);
  const userScope = scopeWhere(scope, "COALESCE(user.agency_account_id,host.agency_account_id)");
  const userWhere = [userScope.clause];
  const userValues: BindValue[] = [...userScope.values];
  if (q) addUserSearch(userWhere, userValues, q, "user");
  const dateWhere = ["1=1"];
  const dateValues: BindValue[] = [];
  addRange(dateWhere, dateValues, "result.created_at", input);
  const dateSql = dateWhere.join(" AND ");
  const where = [...userWhere, "result.wager_total > 0", dateSql].join(" AND ");
  const values = [...userValues, ...dateValues];
  const [summaryRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT user.id user_id, user.public_id, user.full_name,
            COALESCE(wallet.available_balance,0) current_coin_balance,
            COUNT(result.id) total_games_played,
            SUM(CASE WHEN result.payout_total > result.wager_total THEN 1 ELSE 0 END) total_games_won,
            SUM(CASE WHEN result.payout_total < result.wager_total THEN 1 ELSE 0 END) total_games_lost,
            COALESCE(SUM(result.wager_total),0) total_coins_bet,
            COALESCE(SUM(result.payout_total),0) total_coins_won,
            COALESCE(SUM(GREATEST(CAST(result.wager_total AS SIGNED) - CAST(result.payout_total AS SIGNED),0)),0) total_coins_lost,
            COALESCE(SUM(CAST(result.payout_total AS SIGNED) - CAST(result.wager_total AS SIGNED)),0) net_game_result
     FROM game_round_results result
     INNER JOIN application_users user ON user.id = result.application_user_id
     LEFT JOIN host_profiles host ON host.application_user_id = user.id
     LEFT JOIN wallet_balances wallet ON wallet.owner_type = 'APPLICATION_USER' AND wallet.owner_id = user.id AND wallet.asset_type = 'COIN'
     WHERE ${where}
     GROUP BY user.id, user.public_id, user.full_name, wallet.available_balance
     ORDER BY total_coins_bet DESC LIMIT 100`, values,
  ));
  const [countRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) total FROM game_round_results result INNER JOIN application_users user ON user.id = result.application_user_id LEFT JOIN host_profiles host ON host.application_user_id = user.id WHERE ${where}`,
    values,
  ));
  const total = Number(countRows[0]?.total ?? 0);
  if (all && total > REPORT_EXPORT_LIMIT) throw new Error(`Filtered export exceeds ${REPORT_EXPORT_LIMIT.toLocaleString()} rows. Narrow the filters first.`);
  const limit = all ? REPORT_EXPORT_LIMIT : pageSize;
  const [historyRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT result.id result_id, result.client_round_id, result.game_name, result.created_at,
            result.wager_total, result.payout_total, result.balance_after,
            COALESCE(settlement.round_id, result.client_round_id) shared_round_id,
            COALESCE(settlement.deduction_total, CAST(JSON_UNQUOTE(JSON_EXTRACT(result.outcome_json, '$.winningsDeduction')) AS UNSIGNED), 0) deduction_total,
            user.public_id, user.full_name
     FROM game_round_results result
     INNER JOIN application_users user ON user.id = result.application_user_id
     LEFT JOIN host_profiles host ON host.application_user_id = user.id
     LEFT JOIN game_shared_settlements settlement ON settlement.result_record_id = result.id
     WHERE ${where}
     ORDER BY result.created_at DESC LIMIT ${limit + 1} OFFSET ${all ? 0 : offset}`,
    values,
  ));
  const summary = summaryRows.map((row) => ({
    userId: String(row.public_id), userName: String(row.full_name), currentCoinBalance: Number(row.current_coin_balance ?? 0),
    totalGamesPlayed: Number(row.total_games_played), totalGamesWon: Number(row.total_games_won), totalGamesLost: Number(row.total_games_lost),
    totalCoinsBet: Number(row.total_coins_bet), totalCoinsWon: Number(row.total_coins_won), totalCoinsLost: Number(row.total_coins_lost), netGameResult: Number(row.net_game_result),
  }));
  const hasNext = all ? false : offset + Math.min(limit, historyRows.length) < total;
  return { summary, items: historyRows.slice(0, limit).map(mapGame), page, pageSize, total, hasNext };
}

export type CoinTransferInput = ReportPageInput & { mode?: "24h" | "date" };

function coinTransferFilters(scope: Scope, input: CoinTransferInput) {
  // Transfer history is deliberately seller-private, including for otherwise
  // elevated roles: every row must have been created by this exact account.
  const where = ["transfer.sender_account_id = ?", "ledger.status = 'COMPLETED'", "ledger.asset_type = 'COIN'"];
  const values: BindValue[] = [scope.account.id];
  const mode = input.mode === "date" ? "date" : "24h";
  if (mode === "24h") where.push("transfer.created_at >= UTC_TIMESTAMP(3) - INTERVAL 24 HOUR AND transfer.created_at <= UTC_TIMESTAMP(3)");
  else {
    const start = input.date ? istBoundary(input.date) : null;
    if (!start) throw new Error("Choose a valid date in Asia/Kolkata.");
    const end = istBoundary(input.date!, true);
    if (!end) throw new Error("Choose a valid date in Asia/Kolkata.");
    where.push("transfer.created_at >= ? AND transfer.created_at < ?");
    values.push(start, end);
  }
  const q = queryText(input);
  if (q) {
    if (/^\d{1,12}$/.test(q)) { where.push("(user.public_id = ? OR user.external_user_id = ?)"); values.push(Number(q), q); }
    else { where.push("user.full_name LIKE ?"); values.push(`%${q}%`); }
  }
  return { whereSql: where.join(" AND "), values, mode };
}

export async function coinTransferHistory(scope: Scope, input: CoinTransferInput = {}) {
  const { page, pageSize, offset } = pageArgs(input);
  const filter = coinTransferFilters(scope, input);
  const joins = `FROM coin_transfers transfer
    INNER JOIN ledger_transactions ledger ON ledger.id = transfer.ledger_transaction_id
    INNER JOIN application_users user ON user.id = transfer.recipient_application_user_id`;
  const [summaryRows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT COUNT(*) totalTransfers, COALESCE(SUM(transfer.amount),0) totalCoinsTransferred,
            COUNT(DISTINCT user.id) recipientCount,
            MIN(user.public_id) userPublicId, MIN(user.full_name) userName
     ${joins} WHERE ${filter.whereSql}`, filter.values,
  ));
  const summary = summaryRows[0];
  const [rows] = await withDatabaseReadRetry(() => db().execute<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT transfer.id, transfer.transfer_code, transfer.amount, transfer.created_at,
            ledger.transaction_code, ledger.status transaction_status,
            user.public_id user_public_id, user.external_user_id, user.full_name user_name
     ${joins} WHERE ${filter.whereSql}
     ORDER BY transfer.created_at DESC LIMIT ${pageSize + 1} OFFSET ${offset}`,
    filter.values,
  ));
  const total = Number(summary?.totalTransfers ?? 0);
  return {
    mode: filter.mode, page, pageSize, total, hasNext: offset + Math.min(rows.length, pageSize) < total,
    summary: {
      totalTransfers: total, totalCoinsTransferred: Number(summary?.totalCoinsTransferred ?? 0),
      recipientCount: Number(summary?.recipientCount ?? 0),
      userId: Number(summary?.recipientCount ?? 0) === 1 ? String(summary?.userPublicId) : null,
      userName: Number(summary?.recipientCount ?? 0) === 1 ? String(summary?.userName) : null,
    },
    items: rows.slice(0, pageSize).map((row) => ({
      id: String(row.id), userId: String(row.user_public_id), externalUserId: String(row.external_user_id), userName: String(row.user_name),
      amount: Number(row.amount), createdAt: row.created_at as string | Date,
      transactionId: String(row.transaction_code), status: String(row.transaction_status),
    })),
  };
}
