import 'server-only';
import type { RowDataPacket } from 'mysql2/promise';
import type { SessionAccount } from '@/types/platform';
import { db } from '@/lib/db/pool';
import { hostPayoutFilter, PayoutError, type PayoutFilters } from './host-payouts';
import { decimalUsd } from './host-payout-rule';

/** Full filtered SQL ledger totals, not totals of the first detail page. */
export async function agencyPayoutGroups(account:SessionAccount,filters:PayoutFilters={},page=1,exportAll=false) {
  if(account.role!=='MASTER') throw new PayoutError('Only Master may view the global Agency payout list.');
  const f=hostPayoutFilter({account},filters),size=50;
  const [rows]=await db().query<RowDataPacket[]>(`SELECT COALESCE(s.agency_account_id,'INDEPENDENT') agencyKey,
    MIN(s.agency_public_id) agencyPublicId,MIN(s.agency_name) agencyName,
    IF(COUNT(DISTINCT s.country_code)=1,MIN(s.country_code),'MULTIPLE') country,
    COUNT(*) requestCount,COUNT(DISTINCT w.application_user_id) hostCount,SUM(w.amount) diamonds,
    SUM(s.host_usd) hostUsd,SUM(s.agency_usd) agencyUsd,
    SUM(IF(w.status='COMPLETED',s.host_usd,0)) paidUsd,
    SUM(IF(w.status IN ('APPROVED','PROCESSING'),s.host_usd,0)) pendingUsd,
    SUM(w.status='COMPLETED') paidCount,SUM(w.status IN ('APPROVED','PROCESSING')) pendingCount,
    SUM(w.status IN ('FAILED','REVERSED','CANCELLED')) reversedCount,
    SUM(IF(w.status IN ('APPROVED','PROCESSING','COMPLETED'),s.agency_usd,0)) agencyAccruedUsd,
    SUM(IF(s.agency_paid_at IS NOT NULL AND s.agency_reversed_at IS NULL,s.agency_usd,0)) agencyPaidUsd,
    SUM(IF(w.status IN ('APPROVED','PROCESSING','COMPLETED'),s.agency_usd,0))-SUM(IF(s.agency_paid_at IS NOT NULL AND s.agency_reversed_at IS NULL,s.agency_usd,0)) agencyPendingUsd,
    MAX(w.requested_at) latestRequestAt
    FROM withdrawal_requests w JOIN host_payout_snapshots s ON s.withdrawal_id=w.id
    WHERE ${f.where} GROUP BY s.agency_account_id ORDER BY latestRequestAt DESC,agencyKey ${exportAll?'':'LIMIT ? OFFSET ?'}`,
    [...f.values,...(exportAll?[]:[size+1,(Math.max(1,page)-1)*size])]);
  if(exportAll) return {groups:rows,hasNext:false,page:1};
  return {groups:rows.slice(0,size),hasNext:rows.length>size,page};
}

/** Explicit bounded existing IDs. New requests after preview cannot be paid. */
export async function agencyPayoutCandidates(account:SessionAccount,filters:PayoutFilters) {
  if(account.role!=='MASTER'||!filters.agencyGroup) throw new PayoutError('Choose one Agency payment workspace.');
  const f=hostPayoutFilter({account},filters);
  const result:Record<string,{ids:string[];hostUsd:string;agencyUsd:string;hasMore:boolean}>={};
  for(const [kind,condition] of [['paid',"w.status IN ('APPROVED','PROCESSING')"],['agency-paid',"w.status='COMPLETED' AND s.agency_usd>0 AND s.agency_paid_at IS NULL"]]){
    const [rows]=await db().query<RowDataPacket[]>(`SELECT w.id,s.host_usd,s.agency_usd FROM withdrawal_requests w JOIN host_payout_snapshots s ON s.withdrawal_id=w.id
      WHERE ${f.where} AND ${condition} ORDER BY w.id LIMIT 101`,f.values);
    const chosen=rows.slice(0,100);
    const sum=(key:string)=>{const n=chosen.reduce((v,r)=>v+BigInt(decimalUsd(r[key]).replace('.','')),0n);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;};
    result[kind]={ids:chosen.map(r=>String(r.id)),hostUsd:sum('host_usd'),agencyUsd:sum('agency_usd'),hasMore:rows.length>100};
  }
  return result;
}
