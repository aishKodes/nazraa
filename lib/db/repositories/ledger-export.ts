import 'server-only';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from '@/lib/db/pool';
import {scopeWhere} from '@/lib/db/repositories/accounts';
import type {Scope} from '@/types/platform';
export async function ledgerExportPage(scope:Scope,cursor?:{createdAt:string|Date;id:string}) {
  const scopes=['l.actor_account_id','src_account.id','dest_account.id','src_user.agency_account_id','dest_user.agency_account_id'].map(column=>scopeWhere(scope,column));
  const filter=scope.isGlobal?{clause:'1=1',values:[] as string[]}:{clause:`(${scopes.map(item=>item.clause).join(' OR ')})`,values:scopes.flatMap(item=>item.values)};
  const next=cursor?' AND (l.created_at<? OR (l.created_at=? AND l.id<?))':'';
  const [rows]=await db().query<RowDataPacket[]>(`SELECT l.id,l.transaction_code,l.asset_type,l.transaction_type,l.source_type,l.destination_type,
    COALESCE(src_account.public_id,src_user.public_id) source_public_id,COALESCE(src_account.full_name,src_user.full_name) source_name,
    COALESCE(dest_account.public_id,dest_user.public_id) destination_public_id,COALESCE(dest_account.full_name,dest_user.full_name) destination_name,
    source_agency.public_id source_agency_id,source_agency.full_name source_agency_name,
    destination_agency.public_id destination_agency_id,destination_agency.full_name destination_agency_name,
    l.amount,l.money_amount,l.currency,l.payment_method,l.status,l.created_at,actor.public_id actor_public_id
    FROM ledger_transactions l
    LEFT JOIN platform_accounts src_account ON l.source_type='PLATFORM_ACCOUNT' AND src_account.id=l.source_id
    LEFT JOIN application_users src_user ON l.source_type='APPLICATION_USER' AND src_user.id=l.source_id
    LEFT JOIN platform_accounts dest_account ON l.destination_type='PLATFORM_ACCOUNT' AND dest_account.id=l.destination_id
    LEFT JOIN application_users dest_user ON l.destination_type='APPLICATION_USER' AND dest_user.id=l.destination_id
    LEFT JOIN platform_accounts source_agency ON source_agency.id=src_user.agency_account_id
    LEFT JOIN platform_accounts destination_agency ON destination_agency.id=dest_user.agency_account_id
    LEFT JOIN platform_accounts actor ON actor.id=l.actor_account_id
    WHERE ${filter.clause}${next} ORDER BY l.created_at DESC,l.id DESC LIMIT 1000`,[...filter.values,...(cursor?[cursor.createdAt,cursor.createdAt,cursor.id]:[])]);
  return rows;
}
