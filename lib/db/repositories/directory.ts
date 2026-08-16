import "server-only";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";

export type DirectoryUser = {
  id: string; externalUserId: string; fullName: string; countryCode: string | null; status: string;
  level: number; agencyName: string | null; coins: number; diamonds: number; lastActiveAt: string | null; createdAt: string;
};

type UserRow = RowDataPacket & {
  id: string; external_user_id: string; full_name: string; country_code: string | null; account_status: string;
  level_number: number; agency_name: string | null; coins: number; diamonds: number; last_active_at: string | null; created_at: string;
};

export async function listUsers(scope: Scope, search?: string) {
  const filter = scopeWhere(scope, "u.agency_account_id");
  const searchClause = search ? " AND (u.full_name LIKE ? OR u.external_user_id LIKE ?)" : "";
  const values: unknown[] = [...filter.values];
  if (search) values.push(`%${search}%`, `%${search}%`);
  const [rows] = await db().query<UserRow[]>(
    `SELECT u.id, u.external_user_id, u.full_name, u.country_code, u.account_status, u.level_number, u.last_active_at, u.created_at,
            a.full_name agency_name,
            COALESCE(c.available_balance, 0) coins, COALESCE(d.available_balance, 0) diamonds
     FROM application_users u
     LEFT JOIN platform_accounts a ON a.id = u.agency_account_id
     LEFT JOIN wallet_balances c ON c.owner_type = 'APPLICATION_USER' AND c.owner_id = u.id AND c.asset_type = 'COIN'
     LEFT JOIN wallet_balances d ON d.owner_type = 'APPLICATION_USER' AND d.owner_id = u.id AND d.asset_type = 'DIAMOND'
     WHERE ${filter.clause}${searchClause}
     ORDER BY u.created_at DESC LIMIT 100`, values,
  );
  return rows.map((row): DirectoryUser => ({
    id: row.id, externalUserId: row.external_user_id, fullName: row.full_name, countryCode: row.country_code,
    status: row.account_status, level: row.level_number, agencyName: row.agency_name, coins: Number(row.coins), diamonds: Number(row.diamonds), lastActiveAt: row.last_active_at, createdAt: row.created_at,
  }));
}

export async function listHosts(scope: Scope) {
  const filter = scopeWhere(scope, "h.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & {
    id: string; full_name: string; external_user_id: string; status: string; verification_status: string;
    agency_name: string | null; live_minutes_30d: number; sessions_30d: number; gifts_value_30d: number; document_count: number;
  })[]>(
    `SELECT h.id, u.full_name, u.external_user_id, h.status, h.verification_status, a.full_name agency_name,
            h.live_minutes_30d, h.sessions_30d, h.gifts_value_30d, COUNT(d.id) document_count
     FROM host_profiles h INNER JOIN application_users u ON u.id = h.application_user_id
     LEFT JOIN platform_accounts a ON a.id = h.agency_account_id
     LEFT JOIN private_documents d ON d.owner_type = 'HOST_APPLICATION' AND d.owner_id = h.id
     WHERE ${filter.clause} GROUP BY h.id ORDER BY h.updated_at DESC LIMIT 100`, filter.values,
  );
  return rows.map((row) => ({ id: row.id, fullName: row.full_name, externalUserId: row.external_user_id, status: row.status, verificationStatus: row.verification_status, agencyName: row.agency_name, liveMinutes: Number(row.live_minutes_30d), sessions: Number(row.sessions_30d), gifts: Number(row.gifts_value_30d), documentCount: Number(row.document_count) }));
}

export async function listAgencies(scope: Scope) {
  const agencyClause = scope.isGlobal ? "1=1" : `a.id IN (${scope.accountIds.map(() => "?").join(",")})`;
  const [rows] = await db().query<(RowDataPacket & { id: string; role_code: string; full_name: string; country_code: string | null; status: string; owner_name: string | null; host_count: number })[]>(
    `SELECT a.id, a.role_code, a.full_name, a.country_code, a.status, owner.full_name owner_name, COUNT(h.id) host_count
     FROM platform_accounts a LEFT JOIN platform_accounts owner ON owner.id = a.parent_account_id
     LEFT JOIN host_profiles h ON h.agency_account_id = a.id
     WHERE a.role = 'AGENCY' AND ${agencyClause}
     GROUP BY a.id ORDER BY a.created_at DESC LIMIT 100`, scope.isGlobal ? [] : scope.accountIds,
  );
  return rows.map((row) => ({ id: row.id, code: row.role_code, name: row.full_name, country: row.country_code, status: row.status, owner: row.owner_name, hostCount: Number(row.host_count) }));
}

export async function hierarchy(scope: Scope) {
  const where = scope.isGlobal ? "1=1" : `id IN (${scope.accountIds.map(() => "?").join(",")})`;
  const [rows] = await db().query<(RowDataPacket & { id: string; role: string; role_code: string; full_name: string; parent_account_id: string | null; status: string })[]>(
    `SELECT id, role, role_code, full_name, parent_account_id, status FROM platform_accounts WHERE ${where} ORDER BY created_at`,
    scope.isGlobal ? [] : scope.accountIds,
  );
  return rows.map((row) => ({ id: row.id, role: row.role, code: row.role_code, name: row.full_name, parentId: row.parent_account_id, status: row.status }));
}
