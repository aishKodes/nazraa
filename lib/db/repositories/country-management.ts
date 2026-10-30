import 'server-only';
import {randomUUID} from 'node:crypto';
import type {RowDataPacket} from 'mysql2';
import {db} from '@/lib/db/pool';
import {withTransaction} from '@/lib/db/transaction';
import {scopeWhere} from './accounts';
import {canonicalCountryCode, countryName, isPanelCountry, panelCountries} from '@/lib/countries';
import type {Scope} from '@/types/platform';

export function requireCountryAccess(scope:Scope, requested?:string) {
  if (!['MASTER','COUNTRY_MANAGER'].includes(scope.account.role)) throw new Error('Country access denied.');
  const code = requested ? canonicalCountryCode(requested) : scope.countryCode;
  if (scope.account.role==='COUNTRY_MANAGER' && (!code || code!==scope.countryCode)) throw new Error('Country access denied.');
  if (code && !/^[A-Z]{2}$/.test(code)) throw new Error('Choose a valid country.');
  return code || null;
}

export async function countryManagement(scope:Scope, requested?:string) {
  const code = requireCountryAccess(scope,requested);
  const branch = scopeWhere(scope,'a.id');
  const userBranch = scopeWhere(scope,'u.agency_account_id');
  const [accounts, users, rooms, payouts] = await Promise.all([
    db().query<RowDataPacket[]>(`SELECT a.country_code,a.role,COUNT(*) n FROM platform_accounts a
      WHERE a.removed_at IS NULL AND ${branch.clause} ${code?'AND a.country_code=?':''} GROUP BY a.country_code,a.role`, [...branch.values,...(code?[code]:[])]),
    db().query<RowDataPacket[]>(`SELECT u.country_code,COUNT(*) users,SUM(u.is_host=TRUE) hosts,
      COALESCE(SUM(c.available_balance),0) coins,COALESCE(SUM(d.available_balance),0) diamonds
      FROM application_users u
      LEFT JOIN wallet_balances c ON c.owner_type='APPLICATION_USER' AND c.owner_id=u.id AND c.asset_type='COIN'
      LEFT JOIN wallet_balances d ON d.owner_type='APPLICATION_USER' AND d.owner_id=u.id AND d.asset_type='DIAMOND'
      WHERE ${userBranch.clause} ${code?'AND u.country_code=?':''} GROUP BY u.country_code`, [...userBranch.values,...(code?[code]:[])]),
    db().query<RowDataPacket[]>(`SELECT u.country_code,r.room_type,COUNT(*) n FROM live_rooms r JOIN application_users u ON u.id=r.host_application_user_id
      WHERE r.status IN ('ACTIVE','LOCKED') AND ${userBranch.clause} ${code?'AND u.country_code=?':''} GROUP BY u.country_code,r.room_type`, [...userBranch.values,...(code?[code]:[])]),
    db().query<RowDataPacket[]>(`SELECT COALESCE(hp.country_code,a.country_code) country_code,COUNT(*) requests,SUM(w.amount) diamonds,
      SUM(IF(w.status='COMPLETED',1,0)) paid,SUM(IF(w.status IN ('PENDING','UNDER_REVIEW','APPROVED','PROCESSING'),1,0)) pending,
      COALESCE(SUM(COALESCE(hp.host_usd,d.host_usd)),0) host_usd,COALESCE(SUM(COALESCE(hp.agency_usd,d.agency_usd)),0) agency_usd
      FROM withdrawal_requests w
      LEFT JOIN host_payout_snapshots hp ON hp.withdrawal_id=w.id
      LEFT JOIN withdrawal_hierarchy_snapshots h ON h.withdrawal_id=w.id
      LEFT JOIN withdrawal_distribution_snapshots d ON d.withdrawal_id=w.id
      JOIN platform_accounts a ON a.id=COALESCE(hp.agency_account_id,h.agency_account_id,w.agency_account_id)
      WHERE ${branch.clause} ${code?'AND COALESCE(hp.country_code,a.country_code)=?':''} GROUP BY COALESCE(hp.country_code,a.country_code)`, [...branch.values,...(code?[code]:[])]),
  ]);
  for(const row of [...accounts[0],...users[0],...rooms[0],...payouts[0]])
    if(typeof row.country_code==='string')row.country_code=canonicalCountryCode(row.country_code);
  const codes = new Set<string>(code?[code]:panelCountries.map(c=>c.code));
  for (const row of [...accounts[0],...users[0],...rooms[0],...payouts[0]]) if (/^[A-Z]{2}$/.test(String(row.country_code))) codes.add(String(row.country_code));
  const managersFilter=scopeWhere(scope,'a.id');
  const [managers]=await db().query<RowDataPacket[]>(`SELECT a.id,a.public_id,a.full_name,a.country_code,a.status FROM platform_accounts a
    WHERE a.role='COUNTRY_MANAGER' AND a.removed_at IS NULL AND ${managersFilter.clause} ORDER BY a.full_name`,managersFilter.values);
  for(const manager of managers)if(typeof manager.country_code==='string')manager.country_code=canonicalCountryCode(manager.country_code);
  const countries=[...codes].sort((a,b)=>countryName(a).localeCompare(countryName(b))).map(country=>{
    const user=users[0].find(r=>r.country_code===country);
    const count=(role:string)=>Number(accounts[0].find(r=>r.country_code===country&&r.role===role)?.n??0);
    const live=(type:string)=>Number(rooms[0].find(r=>r.country_code===country&&r.room_type===type)?.n??0);
    const payout=payouts[0].find(r=>r.country_code===country);
    return {code:country,name:countryName(country),users:Number(user?.users??0),hosts:Number(user?.hosts??0),agencies:count('AGENCY'),admins:count('ADMIN'),
      coins:Number(user?.coins??0),diamonds:Number(user?.diamonds??0),face:live('FACE')+live('LIVE'),party:live('PARTY'),
      managers:managers.filter(r=>r.country_code===country),payoutRequests:Number(payout?.requests??0),payoutPaid:Number(payout?.paid??0),payoutPending:Number(payout?.pending??0),
      hostUsd:Number(payout?.host_usd??0),agencyUsd:Number(payout?.agency_usd??0)};
  });
  let people:RowDataPacket[]=[],team:RowDataPacket[]=[],activeRooms:RowDataPacket[]=[];
  if(code){
    const [p,t,r]=await Promise.all([
      db().query<RowDataPacket[]>(`SELECT u.public_id,u.full_name,u.is_host,u.account_status FROM application_users u WHERE u.country_code=? AND ${userBranch.clause} ORDER BY u.created_at DESC LIMIT 50`,[code,...userBranch.values]),
      db().query<RowDataPacket[]>(`SELECT a.public_id,a.full_name,a.role,a.status FROM platform_accounts a WHERE a.country_code=? AND a.removed_at IS NULL AND ${branch.clause} ORDER BY a.role,a.full_name LIMIT 100`,[code,...branch.values]),
      db().query<RowDataPacket[]>(`SELECT r.room_code,r.room_type,u.full_name,r.started_at FROM live_rooms r JOIN application_users u ON u.id=r.host_application_user_id WHERE u.country_code=? AND r.status IN ('ACTIVE','LOCKED') AND ${userBranch.clause} ORDER BY r.started_at DESC LIMIT 30`,[code,...userBranch.values]),
    ]);people=p[0];team=t[0];activeRooms=r[0];
  }
  return {selected:code,countries,managers,people,team,activeRooms};
}

export async function assignCountryManager(scope:Scope,input:{accountId:string;countryCode:string;reason:string}) {
  if(scope.account.role!=='MASTER')throw new Error('Only Master may assign a country.');
  const code=canonicalCountryCode(input.countryCode);
  if(!/^[A-Z]{2}$/.test(code)||input.reason.trim().length<5||input.reason.length>500)throw new Error('Select a supported country and enter a reason.');
  if(!isPanelCountry(code)){
    const [existing]=await db().query<RowDataPacket[]>('SELECT country_code FROM platform_accounts WHERE country_code=? UNION SELECT country_code FROM application_users WHERE country_code=? LIMIT 1',[code,code]);
    if(!existing.length)throw new Error('Select a supported existing country.');
  }
  await withTransaction(async c=>{
    const [rows]=await c.query<RowDataPacket[]>("SELECT id,country_code FROM platform_accounts WHERE id=? AND role='COUNTRY_MANAGER' AND removed_at IS NULL AND status='ACTIVE' FOR UPDATE",[input.accountId]);
    if(!rows[0])throw new Error('Select an active Country Manager.');
    // Never silently reclassify an occupied branch or its financial history.
    const [children]=await c.query<RowDataPacket[]>(`WITH RECURSIVE branch AS (
      SELECT id,country_code FROM platform_accounts WHERE parent_account_id=? AND removed_at IS NULL
      UNION ALL SELECT a.id,a.country_code FROM platform_accounts a JOIN branch b ON a.parent_account_id=b.id WHERE a.removed_at IS NULL)
      SELECT id FROM branch WHERE country_code IS NULL OR country_code<>? LIMIT 1`,[input.accountId,code]);
    if(children.length)throw new Error('This branch contains accounts in another or unassigned country. Reassign those accounts through Hierarchy before changing the manager country.');
    await c.execute('UPDATE platform_accounts SET country_code=? WHERE id=?',[code,input.accountId]);
    await c.execute(`INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
      VALUES(?,?,'MASTER','country.manager_assign','accounts','platform_account',?,?,?,?)`,[randomUUID(),scope.account.id,input.accountId,JSON.stringify({countryCode:rows[0].country_code}),JSON.stringify({countryCode:code}),input.reason.trim()]);
  });
}
