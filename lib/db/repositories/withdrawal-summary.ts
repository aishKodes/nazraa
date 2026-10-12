import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import type { Scope } from "@/types/platform";
import { REPORT_EXPORT_LIMIT } from "@/lib/db/repositories/owner-reports";

export type WithdrawalSummaryInput = {
  period?: string; from?: string; to?: string; country?: string; agency?: string;
  status?: string; q?: string; page?: number;
};
type Value = string | number;
const countryColumn = "COALESCE(cm.country_code,a.country_code,u.country_code,'UNKNOWN')";
const agencyColumn = "COALESCE(h.agency_account_id,w.agency_account_id)";
const joins = `FROM withdrawal_requests w
  JOIN application_users u ON u.id=w.application_user_id
  LEFT JOIN withdrawal_hierarchy_snapshots h ON h.withdrawal_id=w.id
  LEFT JOIN withdrawal_distribution_snapshots d ON d.withdrawal_id=w.id
  LEFT JOIN platform_accounts a ON a.id=${agencyColumn}
  LEFT JOIN platform_accounts cm ON cm.id=h.country_manager_account_id
  LEFT JOIN payout_methods pm ON pm.id=w.payout_method_id`;

function boundary(date: string, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a valid IST date range.");
  const parsed = new Date(`${date}T00:00:00+05:30`);
  if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime()+330*60000).toISOString().slice(0,10)!==date)
    throw new Error("Choose a valid IST date range.");
  if (nextDay) parsed.setUTCDate(parsed.getUTCDate()+1);
  return parsed.toISOString().slice(0,23).replace('T',' ');
}

export function withdrawalSummaryFilter(input: WithdrawalSummaryInput, now = new Date()) {
  const where = ["1=1"]; const values: Value[]=[];
  const today = new Date(now.getTime()+330*60000).toISOString().slice(0,10);
  const period = input.period ?? 'month';
  let from: string; let to: string;
  if (period==='custom') {
    from = boundary(input.from??''); to=boundary(input.to??'',true);
    if(from>=to) throw new Error("Choose a valid IST date range.");
  } else {
    let start = today;
    if(period==='month') start=today.slice(0,8)+'01';
    else if(period==='week') {
      const day=new Date(today+'T00:00:00Z');
      day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7); start=day.toISOString().slice(0,10);
    } else if(period!=='today') throw new Error("Choose a valid report period.");
    from=boundary(start); to=boundary(today,true);
  }
  where.push('w.requested_at>=? AND w.requested_at<?'); values.push(from,to);
  if(input.country){
    if(!/^(?:[A-Z]{2}|UNKNOWN)$/.test(input.country)) throw new Error("Choose a valid country.");
    where.push(`${countryColumn}=?`); values.push(input.country);
  }
  if(input.agency){
    if(input.agency==='UNASSIGNED')where.push(`${agencyColumn} IS NULL`);
    else {
      where.push(`(${agencyColumn}=? OR COALESCE(h.agency_public_id,a.public_id)=?)`);
      values.push(input.agency.slice(0,36),/^\d{6}$/.test(input.agency)?Number(input.agency):0);
    }
  }
  if(input.status){
    if(!['PENDING','UNDER_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELLED'].includes(input.status))
      throw new Error("Choose a valid withdrawal status.");
    where.push('w.status=?'); values.push(input.status);
  }
  const q=input.q?.trim().slice(0,120);
  if(q){
    if(/^\d{1,12}$/.test(q)) {
      where.push('(COALESCE(h.host_public_id,u.public_id)=? OR COALESCE(h.agency_public_id,a.public_id)=?)');
      values.push(Number(q),Number(q));
    }else{
      where.push('(COALESCE(h.host_name,u.full_name) LIKE ? OR COALESCE(h.agency_name,a.full_name) LIKE ?)');
      const escaped=q.replace(/[\\%_]/g,'\\$&'); values.push(`%${escaped}%`,`%${escaped}%`);
    }
  }
  return {clause:where.join(' AND '),values,from,to};
}

function requireMaster(scope: Scope) {
  if(scope.account.role!=='MASTER') throw new Error('Only Master may access the withdrawal summary.');
}

const aggregate = `COUNT(*) requests,COUNT(DISTINCT ${agencyColumn}) agencies,
  COUNT(DISTINCT w.application_user_id) hosts,
  SUM(IF(w.status='COMPLETED',w.amount,0)) processed_diamonds,
  SUM(IF(w.status='COMPLETED',d.total_usd,0)) processed_usd,
  SUM(IF(w.status='COMPLETED',d.host_usd,0)) host_payout_usd,
  SUM(IF(w.status='COMPLETED',d.agency_usd,0)) agency_commission_usd,
  SUM(w.status IN ('PENDING','UNDER_REVIEW','APPROVED','PROCESSING')) pending_requests,
  SUM(w.status='COMPLETED' AND d.withdrawal_id IS NULL) missing_distribution_snapshots`;

// Read-only projections of durable snapshots. Never calculate a new payout or
// multiply historical Diamonds by today's exchange/commission configuration.
export async function withdrawalSummary(scope: Scope,input: WithdrawalSummaryInput={},level:'country'|'agency'|'detail'='country',all=false) {
  requireMaster(scope);
  const filter=withdrawalSummaryFilter(input);
  if(level==='agency'&&!input.country) throw new Error('Choose a valid country.');
  if(level==='detail'&&!input.agency&&!all) throw new Error('Choose a valid Agency.');
  const page=Math.max(1,Math.min(10000,Math.trunc(input.page??1)||1)); const pageSize=25;
  const limit=all?REPORT_EXPORT_LIMIT:pageSize;
  const grouping=level==='country'?countryColumn:level==='agency'?agencyColumn:'w.id';
  const [counts]=await db().query<RowDataPacket[]>(`SELECT COUNT(*) total FROM (
    SELECT ${grouping} k ${joins} WHERE ${filter.clause} GROUP BY ${grouping}
  ) groups_count`,filter.values);
  const total=Number(counts[0]?.total??0);
  if(all&&total>REPORT_EXPORT_LIMIT) throw new Error(`Filtered export exceeds ${REPORT_EXPORT_LIMIT.toLocaleString()} rows. Narrow the filters first.`);
  const select=level==='country'?`${countryColumn} country,${aggregate}`
    :level==='agency'?`${agencyColumn} agency_id,MAX(COALESCE(h.agency_public_id,a.public_id)) agency_public_id,
      MAX(COALESCE(h.agency_name,a.full_name)) agency_name,${aggregate}`
    :`w.id,w.withdrawal_code,w.amount,w.status,w.requested_at,w.reviewed_at,w.provider_reference,
      COALESCE(h.host_public_id,u.public_id) host_public_id,COALESCE(h.host_name,u.full_name) host_name,
      ${countryColumn} country,COALESCE(h.agency_public_id,a.public_id) agency_public_id,
      COALESCE(h.agency_name,a.full_name) agency_name,pm.method_type payment_channel,
      d.total_usd,d.host_usd,d.agency_usd,d.super_admin_usd,d.admin_usd,d.bd_usd,
      d.country_manager_usd,d.company_usd,d.usd_inr_rate,d.completed_at`;
  const group=level==='detail'?'':`GROUP BY ${grouping}`;
  const order=level==='detail'?'w.requested_at DESC,w.id':level==='country'?'country':'agency_name,agency_id';
  const [rows]=await db().query<RowDataPacket[]>(`SELECT ${select} ${joins} WHERE ${filter.clause} ${group}
    ORDER BY ${order} LIMIT ${limit} OFFSET ${all?0:(page-1)*pageSize}`,filter.values);
  return {items:rows.map(row=>({...row})),total,page,pageSize,hasNext:!all&&page*pageSize<total,range:{from:filter.from,to:filter.to}};
}

export async function withdrawalSummaryCards(scope: Scope,input:WithdrawalSummaryInput={}) {
  requireMaster(scope); const filter=withdrawalSummaryFilter(input);
  const [rows]=await db().query<RowDataPacket[]>(`SELECT ${aggregate},COUNT(DISTINCT NULLIF(${countryColumn},'UNKNOWN')) countries
    ${joins} WHERE ${filter.clause}`,filter.values);
  return rows[0];
}
