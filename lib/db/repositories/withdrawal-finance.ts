import "server-only";
import { publicApiOrigin } from "@/lib/config/public-api-origin";

import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";
import { loadWithdrawalEconomy,expectedWithdrawalUsd } from "@/lib/db/repositories/withdrawal-economy";
import {REPORT_EXPORT_LIMIT,formatIst as exportRowDate} from '@/lib/db/repositories/owner-reports';

export async function withdrawalFinance(scope: Scope, requestedAgencyId?: string,exportAll=false) {
  const scopedAgencies = scopeWhere(scope, "agency.id");
  const selectedFilter=exportAll&&requestedAgencyId?' AND (agency.id=? OR agency.public_id=?)':'';
  const selectedValues=selectedFilter?[requestedAgencyId!,/^\d{6}$/.test(requestedAgencyId!)?Number(requestedAgencyId):0]:[];
  const [agencyResult, economy] = await Promise.all([db().query<RowDataPacket[]>(
    `SELECT agency.id, agency.public_id, agency.full_name,
            COUNT(DISTINCT host.id) host_count,
            COALESCE(SUM(CASE WHEN wallet.asset_type = 'DIAMOND' THEN wallet.available_balance ELSE 0 END), 0) available_diamonds,
            COALESCE(SUM(CASE WHEN wallet.asset_type = 'DIAMOND' THEN wallet.reserved_balance ELSE 0 END), 0) pending_diamonds,
            COALESCE(SUM(coin_wallet.available_balance),0) available_coins,
            COALESCE(finance.total_withdrawn, 0) total_withdrawn,
            COALESCE(finance.host_payout_inr, 0) host_payout_inr,
            COALESCE(finance.agency_commission_inr, 0) agency_commission_inr,
            COALESCE(finance.super_admin_inr, 0) super_admin_inr,
            COALESCE(finance.admin_inr, 0) admin_inr,
            COALESCE(finance.bd_inr, 0) bd_inr,
            COALESCE(finance.country_manager_inr, 0) country_manager_inr,
            COALESCE(finance.company_inr, 0) company_inr
            ,COALESCE(finance.total_usd,0) total_usd,COALESCE(finance.host_usd,0) host_usd,
            COALESCE(finance.agency_usd,0) agency_usd,COALESCE(finance.super_admin_usd,0) super_admin_usd,
            COALESCE(finance.admin_usd,0) admin_usd,COALESCE(finance.bd_usd,0) bd_usd,
            COALESCE(finance.country_manager_usd,0) country_manager_usd,COALESCE(finance.company_usd,0) company_usd
     FROM platform_accounts agency
     LEFT JOIN application_users host ON host.agency_account_id = agency.id AND host.account_status != 'BANNED'
     LEFT JOIN wallet_balances wallet
       ON wallet.owner_type = 'APPLICATION_USER' AND wallet.owner_id = host.id AND wallet.asset_type = 'DIAMOND'
     LEFT JOIN wallet_balances coin_wallet ON coin_wallet.owner_type='APPLICATION_USER' AND coin_wallet.owner_id=host.id AND coin_wallet.asset_type='COIN'
     LEFT JOIN (
       SELECT hierarchy.agency_account_id,
              SUM(request.amount) total_withdrawn,
              SUM(distribution.host_inr) host_payout_inr,
              SUM(distribution.agency_inr) agency_commission_inr,
              SUM(distribution.super_admin_inr) super_admin_inr,
              SUM(distribution.admin_inr) admin_inr,
              SUM(distribution.bd_inr) bd_inr,
              SUM(distribution.country_manager_inr) country_manager_inr,
              SUM(distribution.company_inr) company_inr
              ,SUM(distribution.total_usd) total_usd,SUM(distribution.host_usd) host_usd,SUM(distribution.agency_usd) agency_usd,
              SUM(distribution.super_admin_usd) super_admin_usd,SUM(distribution.admin_usd) admin_usd,SUM(distribution.bd_usd) bd_usd,
              SUM(distribution.country_manager_usd) country_manager_usd,SUM(distribution.company_usd) company_usd
       FROM withdrawal_distribution_snapshots distribution
       INNER JOIN withdrawal_hierarchy_snapshots hierarchy ON hierarchy.withdrawal_id = distribution.withdrawal_id
       INNER JOIN withdrawal_requests request ON request.id = distribution.withdrawal_id AND request.status = 'COMPLETED'
       GROUP BY hierarchy.agency_account_id
     ) finance ON finance.agency_account_id = agency.id
     WHERE agency.role = 'AGENCY' AND agency.removed_at IS NULL AND ${scopedAgencies.clause}${selectedFilter}
     GROUP BY agency.id, agency.public_id, agency.full_name, finance.total_withdrawn,
              finance.host_payout_inr, finance.agency_commission_inr, finance.super_admin_inr,
              finance.admin_inr, finance.bd_inr, finance.country_manager_inr, finance.company_inr,finance.total_usd,finance.host_usd,finance.agency_usd,
              finance.super_admin_usd,finance.admin_usd,finance.bd_usd,finance.country_manager_usd,finance.company_usd
     ORDER BY agency.full_name, agency.public_id LIMIT 500`,
    [...scopedAgencies.values,...selectedValues],
  ), loadWithdrawalEconomy()]);
  const agencyRows = agencyResult[0];
  // Whole slabs are calculated per Host, exactly as requests are validated;
  // pooling several sub-slab balances would overstate expected withdrawal.
  const [expectations]=await db().query<RowDataPacket[]>(`SELECT u.agency_account_id,
    SUM(FLOOR(COALESCE(w.available_balance,0)/?))*? eligible_diamonds
    FROM application_users u LEFT JOIN wallet_balances w ON w.owner_type='APPLICATION_USER' AND w.owner_id=u.id AND w.asset_type='DIAMOND'
    JOIN platform_accounts agency ON agency.id=u.agency_account_id
    WHERE u.account_status<>'BANNED' AND ${scopedAgencies.clause} GROUP BY u.agency_account_id`,[economy.slabDiamonds,economy.slabDiamonds,...scopedAgencies.values]);
  const [states]=await db().query<RowDataPacket[]>(`SELECT COALESCE(h.agency_account_id,w.agency_account_id) agency_id,w.status,SUM(w.amount) diamonds,COUNT(*) requests,SUM(MOD(w.amount,?)<>0) invalid_slabs
    FROM withdrawal_requests w LEFT JOIN withdrawal_hierarchy_snapshots h ON h.withdrawal_id=w.id
    JOIN platform_accounts agency ON agency.id=COALESCE(h.agency_account_id,w.agency_account_id)
    WHERE ${scopedAgencies.clause} GROUP BY COALESCE(h.agency_account_id,w.agency_account_id),w.status`,[economy.slabDiamonds,...scopedAgencies.values]);
  const agencies = agencyRows.map((row) => ({
    id: String(row.id), publicId: String(row.public_id), name: String(row.full_name),
    hostCount: Number(row.host_count), availableDiamonds: Number(row.available_diamonds),
    pendingDiamonds: Number(row.pending_diamonds), totalWithdrawn: Number(row.total_withdrawn),
    hostPayoutInr: Number(row.host_payout_inr), agencyCommissionInr: Number(row.agency_commission_inr),
    superAdminInr: Number(row.super_admin_inr), adminInr: Number(row.admin_inr),
    bdInr: Number(row.bd_inr), countryManagerInr: Number(row.country_manager_inr),
    companyInr: Number(row.company_inr),
    availableCoins:Number(row.available_coins),totalUsd:Number(row.total_usd),hostUsd:Number(row.host_usd),agencyUsd:Number(row.agency_usd),
    superAdminUsd:Number(row.super_admin_usd),adminUsd:Number(row.admin_usd),bdUsd:Number(row.bd_usd),countryManagerUsd:Number(row.country_manager_usd),companyUsd:Number(row.company_usd),
    expected:expectedWithdrawalUsd(Number(expectations.find(e=>e.agency_account_id===row.id)?.eligible_diamonds??0),economy),
    eligibleWithdrawalDiamonds:Number(expectations.find(e=>e.agency_account_id===row.id)?.eligible_diamonds??0),
    states:states.filter(s=>s.agency_id===row.id).map(s=>({status:String(s.status),diamonds:Number(s.diamonds),requests:Number(s.requests),expected:['PENDING','UNDER_REVIEW','APPROVED','PROCESSING'].includes(s.status)&&!Number(s.invalid_slabs)?expectedWithdrawalUsd(Number(s.diamonds),economy):null})),
  }));
  const selectedAgency = requestedAgencyId
    ? agencies.find((agency) => agency.id === requestedAgencyId || agency.publicId === requestedAgencyId)
    : scope.account.role === "AGENCY" ? agencies.find((agency) => agency.id === scope.account.id) : undefined;
  if (requestedAgencyId && !selectedAgency) throw new Error("Agency finance access is outside your permitted branch.");
  if (!selectedAgency) return { agencies, selectedAgency: null, hosts: [], withdrawals: [] };

  const [hostRows, withdrawalRows] = await Promise.all([
    db().query<RowDataPacket[]>(
      `SELECT host.id, host.public_id, host.full_name,
              CASE WHEN avatar.updated_at IS NOT NULL
                THEN CONCAT('${publicApiOrigin()}/api/v1/mobile/avatar/', host.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000))
                ELSE host.avatar_url END avatar_url,
              COALESCE(wallet.available_balance, 0) available_diamonds,
              COALESCE(wallet.reserved_balance, 0) pending_diamonds,
              COALESCE(finance.total_withdrawn, 0) total_withdrawn,
              COALESCE(finance.host_payout_inr, 0) host_payout_inr,
              COALESCE(finance.agency_commission_inr, 0) agency_commission_inr,
              COALESCE(finance.withdrawal_count, 0) withdrawal_count
              ,COALESCE(finance.host_usd,0) host_usd,COALESCE(finance.agency_usd,0) agency_usd
       FROM application_users host
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = host.id
       LEFT JOIN wallet_balances wallet
         ON wallet.owner_type = 'APPLICATION_USER' AND wallet.owner_id = host.id AND wallet.asset_type = 'DIAMOND'
       LEFT JOIN (
         SELECT hierarchy.host_application_user_id,
                SUM(request.amount) total_withdrawn, SUM(distribution.host_inr) host_payout_inr,
                SUM(distribution.agency_inr) agency_commission_inr, COUNT(*) withdrawal_count
              ,SUM(distribution.host_usd) host_usd,SUM(distribution.agency_usd) agency_usd
         FROM withdrawal_distribution_snapshots distribution
         INNER JOIN withdrawal_hierarchy_snapshots hierarchy ON hierarchy.withdrawal_id = distribution.withdrawal_id
         INNER JOIN withdrawal_requests request ON request.id = distribution.withdrawal_id AND request.status = 'COMPLETED'
         WHERE hierarchy.agency_account_id = ?
         GROUP BY hierarchy.host_application_user_id
       ) finance ON finance.host_application_user_id = host.id
       WHERE host.agency_account_id = ? AND host.account_status != 'BANNED'
       ORDER BY host.full_name, host.public_id LIMIT ${exportAll?REPORT_EXPORT_LIMIT+1:500}`,
      [selectedAgency.id, selectedAgency.id],
    ),
    db().query<RowDataPacket[]>(
      `SELECT request.id, request.withdrawal_code, request.amount, request.status, request.requested_at,
              request.reviewed_at, request.provider_reference, hierarchy.*,
              distribution.slab_diamonds, distribution.slab_count, distribution.total_usd,
              distribution.total_usd_cents_per_slab, distribution.host_usd_cents_per_slab,
              distribution.agency_usd_cents_per_slab, distribution.super_admin_usd_cents_per_slab,
              distribution.admin_usd_cents_per_slab, distribution.bd_usd_cents_per_slab,
              distribution.country_manager_usd_cents_per_slab, distribution.company_usd_cents_per_slab,
              distribution.host_usd, distribution.agency_usd, distribution.super_admin_usd,
              distribution.admin_usd, distribution.bd_usd, distribution.country_manager_usd,
              distribution.company_usd, distribution.usd_inr_rate, distribution.total_inr,
              distribution.host_inr, distribution.agency_inr, distribution.super_admin_inr,
              distribution.admin_inr, distribution.bd_inr, distribution.country_manager_inr,
              distribution.company_inr, distribution.completed_at
              ,status_dates.approved_at,status_dates.processing_at
       FROM withdrawal_requests request
       INNER JOIN withdrawal_hierarchy_snapshots hierarchy ON hierarchy.withdrawal_id = request.id
       LEFT JOIN withdrawal_distribution_snapshots distribution ON distribution.withdrawal_id = request.id
       LEFT JOIN (SELECT withdrawal_id,MIN(IF(to_status='APPROVED',created_at,NULL)) approved_at,
         MIN(IF(to_status='PROCESSING',created_at,NULL)) processing_at FROM withdrawal_status_history GROUP BY withdrawal_id) status_dates ON status_dates.withdrawal_id=request.id
       WHERE hierarchy.agency_account_id = ?
       ORDER BY request.requested_at DESC,request.id LIMIT ${exportAll?REPORT_EXPORT_LIMIT+1:1000}`,
      [selectedAgency.id],
    ),
  ]);
  if(exportAll&&(hostRows[0].length>REPORT_EXPORT_LIMIT||withdrawalRows[0].length>REPORT_EXPORT_LIMIT))throw new Error(`Filtered export exceeds ${REPORT_EXPORT_LIMIT.toLocaleString()} rows. Use the filtered withdrawal detail export.`);
  return {
    agencies,
    selectedAgency,
    hosts: hostRows[0].map((row) => ({
      id: String(row.id), publicId: String(row.public_id), name: String(row.full_name), avatarUrl: row.avatar_url,
      availableDiamonds: Number(row.available_diamonds), pendingDiamonds: Number(row.pending_diamonds),
      nextTarget: (Math.floor(Number(row.available_diamonds) / economy.slabDiamonds) + 1) * economy.slabDiamonds,
      totalWithdrawn: Number(row.total_withdrawn), hostPayoutInr: Number(row.host_payout_inr),
      agencyCommissionInr: Number(row.agency_commission_inr), withdrawalCount: Number(row.withdrawal_count),
      hostUsd:Number(row.host_usd),agencyUsd:Number(row.agency_usd),
      expected:expectedWithdrawalUsd(Math.floor(Number(row.available_diamonds)/economy.slabDiamonds)*economy.slabDiamonds,economy),
    })),
    withdrawals: withdrawalRows[0].map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]),
    )),
  };
}

export async function withdrawalCommissionTotals(scope:Scope) {
  const scoped=scopeWhere(scope,'hierarchy.agency_account_id');
  const [rows]=await db().query<RowDataPacket[]>(`SELECT COUNT(*) completed_requests,
    COALESCE(SUM(request.amount),0) completed_diamonds,
    COALESCE(SUM(distribution.host_usd),0) host_usd,COALESCE(SUM(distribution.agency_usd),0) agency_usd,
    COALESCE(SUM(distribution.host_inr),0) host_inr,COALESCE(SUM(distribution.agency_inr),0) agency_inr
    FROM withdrawal_requests request JOIN withdrawal_hierarchy_snapshots hierarchy ON hierarchy.withdrawal_id=request.id
    JOIN withdrawal_distribution_snapshots distribution ON distribution.withdrawal_id=request.id
    WHERE request.status='COMPLETED' AND ${scoped.clause}`,scoped.values);
  return rows[0];
}

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if(/^[=+@\-\t\r]/.test(text))text="'"+text;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function agencyWithdrawalCsv(scope: Scope, agencyId: string) {
  const finance = await withdrawalFinance(scope, agencyId,true);
  if (!finance.selectedAgency) throw new Error("Agency was not found.");
  const agency = finance.agencies.find((item) => item.id === finance.selectedAgency!.id)!;
  const summaryColumns = [
    "agency_public_id", "agency_name", "host_count", "available_diamonds", "pending_diamonds",
    "total_withdrawn_diamonds", "host_usd","agency_usd","expected_host_usd","expected_agency_usd", "host_payout_inr", "agency_commission_inr", "super_admin_inr",
    "admin_inr", "bd_inr", "country_manager_inr", "company_inr",
  ];
  const summary = {
    agency_public_id: agency.publicId, agency_name: agency.name, host_count: agency.hostCount,
    available_diamonds: agency.availableDiamonds, pending_diamonds: agency.pendingDiamonds,
    total_withdrawn_diamonds: agency.totalWithdrawn, host_payout_inr: agency.hostPayoutInr,
    host_usd:agency.hostUsd,agency_usd:agency.agencyUsd,expected_host_usd:agency.expected.host,expected_agency_usd:agency.expected.agency,
    agency_commission_inr: agency.agencyCommissionInr, super_admin_inr: agency.superAdminInr,
    admin_inr: agency.adminInr, bd_inr: agency.bdInr, country_manager_inr: agency.countryManagerInr,
    company_inr: agency.companyInr,
  };
  const hostColumns = [
    "host_public_id", "host_name", "available_diamonds", "pending_diamonds", "next_target",
    "total_withdrawn_diamonds", "host_usd", "agency_usd", "expected_host_usd", "expected_agency_usd", "host_payout_inr", "agency_commission_inr", "withdrawal_count",
  ];
  const columns = [
    "withdrawal_code", "host_public_id", "host_name", "agency_public_id", "agency_name",
    "bd_public_id", "bd_name", "admin_public_id", "admin_name", "super_admin_public_id",
    "super_admin_name", "country_manager_public_id", "country_manager_name", "amount", "status",
    "requested_at","reviewed_at","approved_at","processing_at", "completed_at", "provider_reference", "slab_diamonds", "slab_count",
    "total_usd_cents_per_slab", "host_usd_cents_per_slab", "agency_usd_cents_per_slab",
    "super_admin_usd_cents_per_slab", "admin_usd_cents_per_slab", "bd_usd_cents_per_slab",
    "country_manager_usd_cents_per_slab", "company_usd_cents_per_slab",
    "usd_inr_rate", "total_usd", "host_usd", "agency_usd", "super_admin_usd", "admin_usd",
    "bd_usd", "country_manager_usd", "company_usd", "total_inr", "host_inr", "agency_inr",
    "super_admin_inr", "admin_inr", "bd_inr", "country_manager_inr", "company_inr",
  ];
  return [
    "Agency summary",
    summaryColumns.map(csvCell).join(","),
    summaryColumns.map((column) => csvCell(summary[column as keyof typeof summary])).join(","),
    "",
    "Host balances",
    hostColumns.map(csvCell).join(","),
    ...finance.hosts.map((host) => [
      host.publicId, host.name, host.availableDiamonds, host.pendingDiamonds, host.nextTarget,
      host.totalWithdrawn, host.hostUsd, host.agencyUsd, host.expected.host, host.expected.agency, host.hostPayoutInr, host.agencyCommissionInr, host.withdrawalCount,
    ].map(csvCell).join(",")),
    "",
    "Withdrawal details",
    columns.map(csvCell).join(","),
    ...finance.withdrawals.map((row) => columns.map((column) => csvCell(column.endsWith('_at')?exportRowDate(row[column] as Date|string|null):row[column])).join(",")),
  ].join("\r\n");
}
