import 'server-only';
import {db} from '@/lib/db/pool';
import {withTransaction} from '@/lib/db/transaction';
import {randomUUID} from 'node:crypto';
import type {Scope} from '@/types/platform';
import type {RowDataPacket} from 'mysql2/promise';
import {luckyPolicy,luckyExpectation,type LuckyPolicy} from '@/lib/policy/lucky-gifts';
export async function luckyGiftControl(scope:Scope){
 if(scope.account.role!=='MASTER')throw Error('Only Master can view Lucky Gift economics.');
 const [rows]=await db().query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.lucky_gifts'");
 const policy=luckyPolicy(rows[0]?.setting_value);
 const [daily]=await db().query<RowDataPacket[]>(`SELECT DATE_FORMAT(r.created_at,'%Y-%m-%d') day,COUNT(*) attempts,SUM(r.gross_coins) gross,SUM(r.receiver_diamonds) receiverDiamonds,SUM(r.company_allocation) companyAllocation,SUM(r.reward_coins) luckyPayout,SUM(r.company_allocation)-SUM(r.reward_coins) netCompanyCoins,SUM(r.won) wins FROM lucky_gift_results r GROUP BY DATE_FORMAT(r.created_at,'%Y-%m-%d') ORDER BY day DESC LIMIT 31`);
 return {policy,expectation:luckyExpectation(policy),daily};
}
export async function saveLuckyGiftControl(scope:Scope,policy:LuckyPolicy,reason:string){
 if(scope.account.role!=='MASTER')throw Error('Only Master can configure Lucky Gifts.');
 const checked=luckyPolicy(policy);if(reason.trim().length<5||reason.length>500)throw Error('Enter a configuration reason.');
 await withTransaction(async c=>{
  const [rows]=await c.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.lucky_gifts' FOR UPDATE");
  const old=luckyPolicy(rows[0]?.setting_value);checked.version=old.version+1;
  await c.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.lucky_gifts',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)",[JSON.stringify(checked),scope.account.id]);
  await c.execute("INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,reason) VALUES(?,?,?,'lucky_gifts.policy_update','settings','system_setting','mobile.lucky_gifts',?)",[randomUUID(),scope.account.id,scope.account.role,reason]);
 });
}
