import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";

export type WithdrawalEconomy = {
  slabDiamonds: number;
  totalUsdCents: number;
  hostUsdCents: number;
  agencyUsdCents: number;
  superAdminUsdCents: number;
  adminUsdCents: number;
  bdUsdCents: number;
  countryManagerUsdCents: number;
  companyUsdCents: number;
  usdInrRate: number;
};

export const defaultWithdrawalEconomy: WithdrawalEconomy = {
  slabDiamonds: 100_000,
  totalUsdCents: 1170,
  hostUsdCents: 800,
  agencyUsdCents: 100,
  superAdminUsdCents: 58,
  adminUsdCents: 18,
  bdUsdCents: 17,
  countryManagerUsdCents: 35,
  companyUsdCents: 142,
  usdInrRate: 90,
};

function objectValue(value: unknown) {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseWithdrawalEconomy(value: unknown): WithdrawalEconomy {
  const source = objectValue(value);
  const result = {
    slabDiamonds: positiveInteger(source.slabDiamonds, defaultWithdrawalEconomy.slabDiamonds),
    totalUsdCents: positiveInteger(source.totalUsdCents, defaultWithdrawalEconomy.totalUsdCents),
    hostUsdCents: nonNegativeInteger(source.hostUsdCents, defaultWithdrawalEconomy.hostUsdCents),
    agencyUsdCents: nonNegativeInteger(source.agencyUsdCents, defaultWithdrawalEconomy.agencyUsdCents),
    superAdminUsdCents: nonNegativeInteger(source.superAdminUsdCents, defaultWithdrawalEconomy.superAdminUsdCents),
    adminUsdCents: nonNegativeInteger(source.adminUsdCents, defaultWithdrawalEconomy.adminUsdCents),
    bdUsdCents: nonNegativeInteger(source.bdUsdCents, defaultWithdrawalEconomy.bdUsdCents),
    countryManagerUsdCents: nonNegativeInteger(source.countryManagerUsdCents, defaultWithdrawalEconomy.countryManagerUsdCents),
    companyUsdCents: nonNegativeInteger(source.companyUsdCents, defaultWithdrawalEconomy.companyUsdCents),
    usdInrRate: Number(source.usdInrRate) > 0 ? Number(source.usdInrRate) : defaultWithdrawalEconomy.usdInrRate,
  };
  validateWithdrawalEconomy(result);
  return result;
}

export function validateWithdrawalEconomy(value: WithdrawalEconomy) {
  const distributed = value.hostUsdCents + value.agencyUsdCents + value.superAdminUsdCents
    + value.adminUsdCents + value.bdUsdCents + value.countryManagerUsdCents + value.companyUsdCents;
  if (distributed !== value.totalUsdCents) throw new Error("Withdrawal USD allocations must equal the total economic value.");
  if (value.adminUsdCents + value.bdUsdCents !== 35) throw new Error("Admin and BD must remain a combined $0.35 per slab.");
  if (!Number.isFinite(value.usdInrRate) || value.usdInrRate <= 0 || value.usdInrRate > 1000) throw new Error("Choose a valid USD to INR rate.");
}

export async function loadWithdrawalEconomy(connection?: PoolConnection) {
  const runner = connection ?? db();
  const [rows] = await runner.query<(RowDataPacket & { setting_value: unknown })[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'withdrawal.economy' LIMIT 1",
  );
  return parseWithdrawalEconomy(rows[0]?.setting_value);
}

type AccountSnapshot = { id: string; public_id: number; full_name: string; role: string; depth: number };

export async function captureWithdrawalHierarchy(
  connection: PoolConnection,
  input: { withdrawalId: string; applicationUserId: string; agencyAccountId: string | null },
) {
  const [userRows] = await connection.query<(RowDataPacket & { public_id: number; full_name: string })[]>(
    "SELECT public_id, full_name FROM application_users WHERE id = ? LIMIT 1",
    [input.applicationUserId],
  );
  const user = userRows[0];
  if (!user) throw new Error("Withdrawal host was not found.");

  let hierarchy: AccountSnapshot[] = [];
  if (input.agencyAccountId) {
    const [accountRows] = await connection.query<(RowDataPacket & AccountSnapshot)[]>(
      `WITH RECURSIVE ancestors AS (
         SELECT id, public_id, full_name, role, parent_account_id, 0 depth
         FROM platform_accounts WHERE id = ?
         UNION ALL
         SELECT parent.id, parent.public_id, parent.full_name, parent.role, parent.parent_account_id, child.depth + 1
         FROM platform_accounts parent
         INNER JOIN ancestors child ON child.parent_account_id = parent.id
         WHERE child.depth < 10
       )
       SELECT id, public_id, full_name, role, depth FROM ancestors ORDER BY depth`,
      [input.agencyAccountId],
    );
    hierarchy = accountRows;
  }
  const role = (name: string) => hierarchy.find((account) => account.role === name);
  const agency = role("AGENCY");
  const bd = role("BD");
  const admin = role("ADMIN");
  const superAdmin = role("SUPER_ADMIN");
  const countryManager = role("COUNTRY_MANAGER");
  await connection.execute(
    `INSERT IGNORE INTO withdrawal_hierarchy_snapshots
      (withdrawal_id, host_application_user_id, host_public_id, host_name,
       agency_account_id, agency_public_id, agency_name,
       bd_account_id, bd_public_id, bd_name, admin_account_id, admin_public_id, admin_name,
       super_admin_account_id, super_admin_public_id, super_admin_name,
       country_manager_account_id, country_manager_public_id, country_manager_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.withdrawalId, input.applicationUserId, user.public_id, user.full_name,
      agency?.id ?? input.agencyAccountId, agency?.public_id ?? null, agency?.full_name ?? null,
      bd?.id ?? null, bd?.public_id ?? null, bd?.full_name ?? null,
      admin?.id ?? null, admin?.public_id ?? null, admin?.full_name ?? null,
      superAdmin?.id ?? null, superAdmin?.public_id ?? null, superAdmin?.full_name ?? null,
      countryManager?.id ?? null, countryManager?.public_id ?? null, countryManager?.full_name ?? null],
  );
}

function usd(centsPerSlab: number, slabs: number) {
  return ((centsPerSlab * slabs) / 100).toFixed(2);
}

function inr(centsPerSlab: number, slabs: number, rate: number) {
  return ((centsPerSlab * slabs * rate) / 100).toFixed(2);
}

export async function finalizeWithdrawalDistribution(
  connection: PoolConnection,
  input: {
    withdrawalId: string;
    amount: number;
    applicationUserId: string;
    agencyAccountId: string | null;
    actorAccountId: string;
    providerReference: string;
  },
) {
  const economy = await loadWithdrawalEconomy(connection);
  if (input.amount % economy.slabDiamonds !== 0) throw new Error(`Withdrawals must use exact ${economy.slabDiamonds.toLocaleString("en-IN")} diamond slabs.`);
  await captureWithdrawalHierarchy(connection, input);
  const slabs = input.amount / economy.slabDiamonds;
  await connection.execute(
    `INSERT INTO withdrawal_distribution_snapshots
      (withdrawal_id, slab_diamonds, slab_count, total_usd_cents_per_slab, host_usd_cents_per_slab,
       agency_usd_cents_per_slab, super_admin_usd_cents_per_slab, admin_usd_cents_per_slab,
       bd_usd_cents_per_slab, country_manager_usd_cents_per_slab, company_usd_cents_per_slab,
       total_usd, host_usd, agency_usd, super_admin_usd,
       admin_usd, bd_usd, country_manager_usd, company_usd, usd_inr_rate, total_inr, host_inr,
       agency_inr, super_admin_inr, admin_inr, bd_inr, country_manager_inr, company_inr,
       completed_by, provider_reference)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.withdrawalId, economy.slabDiamonds, slabs,
      economy.totalUsdCents, economy.hostUsdCents, economy.agencyUsdCents, economy.superAdminUsdCents,
      economy.adminUsdCents, economy.bdUsdCents, economy.countryManagerUsdCents, economy.companyUsdCents,
      usd(economy.totalUsdCents, slabs), usd(economy.hostUsdCents, slabs), usd(economy.agencyUsdCents, slabs),
      usd(economy.superAdminUsdCents, slabs), usd(economy.adminUsdCents, slabs), usd(economy.bdUsdCents, slabs),
      usd(economy.countryManagerUsdCents, slabs), usd(economy.companyUsdCents, slabs), economy.usdInrRate.toFixed(6),
      inr(economy.totalUsdCents, slabs, economy.usdInrRate), inr(economy.hostUsdCents, slabs, economy.usdInrRate),
      inr(economy.agencyUsdCents, slabs, economy.usdInrRate), inr(economy.superAdminUsdCents, slabs, economy.usdInrRate),
      inr(economy.adminUsdCents, slabs, economy.usdInrRate), inr(economy.bdUsdCents, slabs, economy.usdInrRate),
      inr(economy.countryManagerUsdCents, slabs, economy.usdInrRate), inr(economy.companyUsdCents, slabs, economy.usdInrRate),
      input.actorAccountId, input.providerReference],
  );
  await connection.execute(
    "UPDATE withdrawal_requests SET net_payout = ?, currency = 'INR' WHERE id = ?",
    [inr(economy.hostUsdCents, slabs, economy.usdInrRate), input.withdrawalId],
  );
  return { economy, slabs, hostInr: inr(economy.hostUsdCents, slabs, economy.usdInrRate) };
}
