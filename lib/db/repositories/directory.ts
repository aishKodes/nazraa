import "server-only";

import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { PageRequest, PageResult, Role, Scope } from "@/types/platform";

export type DirectoryUser = {
  id: string; externalUserId: string; fullName: string; countryCode: string | null; status: string;
  level: number; agencyName: string | null; coins: number; diamonds: number; lastActiveAt: string | null; createdAt: string;
};

type UserRow = RowDataPacket & {
  id: string; external_user_id: string; full_name: string; country_code: string | null; account_status: string;
  level_number: number; agency_name: string | null; coins: number; diamonds: number; last_active_at: string | null; created_at: string;
};

type HostRow = RowDataPacket & {
  id: string; full_name: string; external_user_id: string; status: string; verification_status: string;
  agency_name: string | null; live_minutes_30d: number; sessions_30d: number; gifts_value_30d: number; document_count: number;
};

type AgencyRow = RowDataPacket & {
  id: string; public_id: number; full_name: string; country_code: string | null; status: string;
  owner_name: string | null; host_count: number;
};

function pageInput(input: PageRequest = {}) {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(10, Math.trunc(input.pageSize ?? 25)));
  return { page, pageSize, offset: (page - 1) * pageSize, search: input.search?.trim().slice(0, 120) || "" };
}

function mapUser(row: UserRow): DirectoryUser {
  return {
    id: row.id, externalUserId: row.external_user_id, fullName: row.full_name, countryCode: row.country_code,
    status: row.account_status, level: Number(row.level_number), agencyName: row.agency_name,
    coins: Number(row.coins), diamonds: Number(row.diamonds), lastActiveAt: row.last_active_at, createdAt: row.created_at,
  };
}

function userQuery(where: string) {
  return `SELECT u.id, u.external_user_id, u.full_name, u.country_code, u.account_status, u.level_number,
                 u.last_active_at, u.created_at, agency.full_name agency_name,
                 COALESCE(coins.available_balance, 0) coins, COALESCE(diamonds.available_balance, 0) diamonds
          FROM application_users u
          LEFT JOIN platform_accounts agency ON agency.id = u.agency_account_id
          LEFT JOIN wallet_balances coins
            ON coins.owner_type = 'APPLICATION_USER' AND coins.owner_id = u.id AND coins.asset_type = 'COIN'
          LEFT JOIN wallet_balances diamonds
            ON diamonds.owner_type = 'APPLICATION_USER' AND diamonds.owner_id = u.id AND diamonds.asset_type = 'DIAMOND'
          WHERE ${where}`;
}

export async function listUsers(scope: Scope, search?: string, limit = 100) {
  const result = await listUsersPage(scope, { search, pageSize: Math.min(50, limit) });
  if (limit <= 50 || !result.hasNext) return result.items;
  const second = await listUsersPage(scope, { search, page: 2, pageSize: Math.min(50, limit - 50) });
  return [...result.items, ...second.items];
}

export async function listUsersPage(scope: Scope, input: PageRequest = {}): Promise<PageResult<DirectoryUser>> {
  const { page, pageSize, offset, search } = pageInput(input);
  const scoped = scopeWhere(scope, "u.agency_account_id");
  const filters = [scoped.clause];
  const values: unknown[] = [...scoped.values];
  if (search) {
    if (/^\d{1,10}$/.test(search)) {
      filters.push("(u.public_id = ? OR u.external_user_id = ? OR u.whatsapp_e164 LIKE ?)");
      values.push(Number(search), search, `${search}%`);
    } else {
      filters.push("(u.full_name LIKE ? OR u.whatsapp_e164 LIKE ? OR u.email LIKE ?)");
      const prefix = `${search}%`;
      values.push(prefix, prefix, prefix);
    }
  }
  const [rows] = await db().query<UserRow[]>(
    `${userQuery(filters.join(" AND "))} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...values, pageSize + 1, offset],
  );
  return { items: rows.slice(0, pageSize).map(mapUser), page, pageSize, hasNext: rows.length > pageSize };
}

function mapHost(row: HostRow) {
  return {
    id: row.id, fullName: row.full_name, externalUserId: row.external_user_id, status: row.status,
    verificationStatus: row.verification_status, agencyName: row.agency_name,
    liveMinutes: Number(row.live_minutes_30d), sessions: Number(row.sessions_30d), gifts: Number(row.gifts_value_30d),
    documentCount: Number(row.document_count),
  };
}

export async function listHosts(scope: Scope, limit = 100) {
  return (await listHostsPage(scope, { pageSize: Math.min(limit, 50) })).items;
}

export async function listHostsPage(scope: Scope, input: PageRequest = {}): Promise<PageResult<ReturnType<typeof mapHost>>> {
  const { page, pageSize, offset, search } = pageInput(input);
  const scoped = scopeWhere(scope, "h.agency_account_id");
  const filters = [scoped.clause];
  const values: unknown[] = [...scoped.values];
  if (search) {
    if (/^\d{1,10}$/.test(search)) {
      filters.push("(u.public_id = ? OR u.external_user_id = ? OR u.whatsapp_e164 LIKE ?)");
      values.push(Number(search), search, `${search}%`);
    } else {
      filters.push("(u.full_name LIKE ? OR u.whatsapp_e164 LIKE ?)");
      values.push(`${search}%`, `${search}%`);
    }
  }
  const [rows] = await db().query<HostRow[]>(
    `SELECT h.id, u.full_name, u.external_user_id, h.status, h.verification_status, agency.full_name agency_name,
            h.live_minutes_30d, h.sessions_30d, h.gifts_value_30d, COALESCE(documents.document_count, 0) document_count
     FROM host_profiles h
     INNER JOIN application_users u ON u.id = h.application_user_id
     LEFT JOIN platform_accounts agency ON agency.id = h.agency_account_id
     LEFT JOIN (
       SELECT owner_id, COUNT(*) document_count FROM private_documents
       WHERE owner_type = 'HOST_APPLICATION' GROUP BY owner_id
     ) documents ON documents.owner_id = h.id
     WHERE ${filters.join(" AND ")} ORDER BY h.updated_at DESC LIMIT ? OFFSET ?`,
    [...values, pageSize + 1, offset],
  );
  return { items: rows.slice(0, pageSize).map(mapHost), page, pageSize, hasNext: rows.length > pageSize };
}

function mapAgency(row: AgencyRow) {
  return {
    id: row.id, code: String(row.public_id), name: row.full_name, country: row.country_code, status: row.status,
    owner: row.owner_name, hostCount: Number(row.host_count),
  };
}

export async function listAgencies(scope: Scope, limit = 100) {
  return (await listAgenciesPage(scope, { pageSize: Math.min(limit, 50) })).items;
}

export async function listAgenciesPage(scope: Scope, input: PageRequest = {}): Promise<PageResult<ReturnType<typeof mapAgency>>> {
  const { page, pageSize, offset, search } = pageInput(input);
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "agency.id");
  const filters = ["agency.role = 'AGENCY'", scoped.clause];
  const values: unknown[] = [...scoped.values];
  if (search) {
    if (/^\d{1,6}$/.test(search)) {
      filters.push("agency.public_id = ?");
      values.push(Number(search));
    } else {
      filters.push("(agency.full_name LIKE ? OR agency.mobile LIKE ?)");
      values.push(`${search}%`, `${search}%`);
    }
  }
  const [rows] = await db().query<AgencyRow[]>(
    `SELECT agency.id, agency.public_id, agency.full_name, agency.country_code, agency.status,
            owner.full_name owner_name, COALESCE(hosts.host_count, 0) host_count
     FROM platform_accounts agency
     LEFT JOIN platform_accounts owner ON owner.id = agency.parent_account_id
     LEFT JOIN (SELECT agency_account_id, COUNT(*) host_count FROM host_profiles GROUP BY agency_account_id) hosts
       ON hosts.agency_account_id = agency.id
     WHERE ${filters.join(" AND ")} ORDER BY agency.created_at DESC LIMIT ? OFFSET ?`,
    [...values, pageSize + 1, offset],
  );
  return { items: rows.slice(0, pageSize).map(mapAgency), page, pageSize, hasNext: rows.length > pageSize };
}

export async function hierarchy(scope: Scope) {
  const accountWhere = scope.isGlobal ? "1=1" : `id IN (${scope.accountIds.map(() => "?").join(",")})`;
  const hostWhere = scope.isGlobal
    ? "1=1"
    : scope.accountIds.length
      ? `h.agency_account_id IN (${scope.accountIds.map(() => "?").join(",")})`
      : "1=0";
  const [accountRows, hostRows] = await Promise.all([
    db().query<(RowDataPacket & { id: string; public_id: number; role: Role; full_name: string; parent_account_id: string | null; status: string })[]>(
      `SELECT id, public_id, role, full_name, parent_account_id, status
       FROM platform_accounts WHERE removed_at IS NULL AND ${accountWhere} ORDER BY created_at`,
      scope.isGlobal ? [] : scope.accountIds,
    ),
    db().query<(RowDataPacket & { agency_account_id: string; host_count: number; live_minutes: number; sessions: number; gift_value: number })[]>(
      `SELECT h.agency_account_id, COUNT(*) host_count, SUM(h.live_minutes_30d) live_minutes,
              SUM(h.sessions_30d) sessions, SUM(h.gifts_value_30d) gift_value
       FROM host_profiles h WHERE h.agency_account_id IS NOT NULL AND ${hostWhere}
       GROUP BY h.agency_account_id`,
      scope.isGlobal ? [] : scope.accountIds,
    ),
  ]);

  type HierarchyNode = {
    id: string; role: string; code: string; name: string; parentId: string | null; status: string;
    detailHref: string; hostCount: number; liveMinutes: number; sessions: number; giftValue: number;
  };
  const hostTotals = new Map(hostRows[0].map((row) => [row.agency_account_id, row]));
  const nodes: HierarchyNode[] = accountRows[0].map((row) => ({
      id: row.id, role: row.role, code: String(row.public_id), name: row.full_name,
      parentId: row.parent_account_id, status: row.status, detailHref: `/dashboard/accounts/${row.id}`,
      hostCount: Number(hostTotals.get(row.id)?.host_count ?? 0), liveMinutes: Number(hostTotals.get(row.id)?.live_minutes ?? 0),
      sessions: Number(hostTotals.get(row.id)?.sessions ?? 0), giftValue: Number(hostTotals.get(row.id)?.gift_value ?? 0),
    }));
  const children = new Map<string, HierarchyNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const summarized = new Map<string, Pick<HierarchyNode, "hostCount" | "liveMinutes" | "sessions" | "giftValue">>();
  function summary(node: HierarchyNode, trail = new Set<string>()) {
    if (summarized.has(node.id)) return summarized.get(node.id)!;
    if (trail.has(node.id)) return { hostCount: node.hostCount, liveMinutes: node.liveMinutes, sessions: node.sessions, giftValue: node.giftValue };
    const nextTrail = new Set(trail).add(node.id);
    const total = (children.get(node.id) ?? []).reduce((result, child) => {
      const childSummary = summary(child, nextTrail);
      result.hostCount += childSummary.hostCount;
      result.liveMinutes += childSummary.liveMinutes;
      result.sessions += childSummary.sessions;
      result.giftValue += childSummary.giftValue;
      return result;
    }, { hostCount: node.hostCount, liveMinutes: node.liveMinutes, sessions: node.sessions, giftValue: node.giftValue });
    summarized.set(node.id, total);
    return total;
  }
  return nodes.map((node) => ({ ...node, ...summary(node) }));
}
