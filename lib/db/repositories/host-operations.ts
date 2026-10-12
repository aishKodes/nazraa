import "server-only";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopeWhere, monitoringScopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";

export async function hostOperationalActivity(scope: Scope, requestedIds: string[]) {
  if (!can(scope.account.role, "hosts.read")) throw new Error("Host access is not permitted.");
  const ids = [...new Set(requestedIds)].slice(0, 50);
  if (!ids.length) return [];
  const scoped = (scope.account.role==='MONITORING_CS'?monitoringScopeWhere:scopeWhere)(scope, "COALESCE(h.agency_account_id,u.agency_account_id)");
  const [users] = await db().query<RowDataPacket[]>(
    `SELECT u.id, u.public_id, u.full_name, u.avatar_url, h.status,
       a.public_id agency_id,a.full_name agency_name,p.public_id admin_id,p.full_name admin_name,
       COALESCE(c.available_balance,0) coins,COALESCE(d.available_balance,0) diamonds
     FROM application_users u JOIN host_profiles h ON h.application_user_id=u.id
     LEFT JOIN platform_accounts a ON a.id=COALESCE(h.agency_account_id,u.agency_account_id)
     LEFT JOIN platform_accounts p ON p.id=a.parent_account_id AND p.role IN ('ADMIN','BD')
     LEFT JOIN wallet_balances c ON c.owner_type='APPLICATION_USER' AND c.owner_id=u.id AND c.asset_type='COIN'
     LEFT JOIN wallet_balances d ON d.owner_type='APPLICATION_USER' AND d.owner_id=u.id AND d.asset_type='DIAMOND'
     WHERE u.id IN (${ids.map(()=>"?").join(",")}) AND ${scoped.clause}`, [...ids,...scoped.values]);
  if (!users.length) return [];
  const permitted=users.map(row=>String(row.id)); const places=permitted.map(()=>"?").join(",");
  const [days,rules,gifts]=await Promise.all([
    db().query<RowDataPacket[]>(`SELECT host_application_user_id,IF(room_type='PARTY','PARTY','FACE') mode,business_date,
      SUM(GREATEST(COALESCE(eligible_seconds_committed,0),COALESCE(valid_media_seconds,0))) seconds
      FROM live_session_accounting WHERE host_application_user_id IN (${places}) AND status<>'VOID'
      AND started_at>=UTC_TIMESTAMP(3)-INTERVAL 30 DAY GROUP BY host_application_user_id,mode,business_date`,permitted),
    db().query<RowDataPacket[]>(`SELECT minimum_eligible_seconds FROM host_reward_rules
      WHERE room_type IN ('FACE','LIVE') AND enabled=TRUE ORDER BY effective_from DESC LIMIT 1`),
    db().query<RowDataPacket[]>(`SELECT g.receiver_application_user_id user_id,IF(r.room_type='PARTY','PARTY','FACE') mode,
      SUM(g.diamond_value) diamonds FROM live_room_gift_events g JOIN live_rooms r ON r.id=g.room_id
      WHERE g.receiver_application_user_id IN (${places}) AND g.created_at>=UTC_TIMESTAMP(3)-INTERVAL 30 DAY
      GROUP BY g.receiver_application_user_id,mode`,permitted),
  ]);
  const threshold=rules[0][0]&&Number(rules[0][0].minimum_eligible_seconds)>0?Number(rules[0][0].minimum_eligible_seconds):null;
  return users.map(user=>{
    const activity=days[0].filter(row=>row.host_application_user_id===user.id);
    const face=activity.filter(row=>row.mode==='FACE'),party=activity.filter(row=>row.mode==='PARTY');
    const gift=(mode:string)=>Number(gifts[0].find(row=>row.user_id===user.id&&row.mode===mode)?.diamonds??0);
    return {userId:String(user.id),publicId:String(user.public_id),name:String(user.full_name),avatarUrl:user.avatar_url as string|null,
      status:String(user.status),agencyId:user.agency_id==null?null:String(user.agency_id),agencyName:user.agency_name as string|null,
      adminId:user.admin_id==null?null:String(user.admin_id),adminName:user.admin_name as string|null,
      coins:Number(user.coins),diamonds:Number(user.diamonds),faceSeconds:face.reduce((sum,row)=>sum+Number(row.seconds),0),
      faceValidDays:threshold==null?null:face.filter(row=>Number(row.seconds)>=threshold).length,
      faceWorking:face.some(row=>Number(row.seconds)>0),faceGiftDiamonds:gift('FACE'),
      partySeconds:party.reduce((sum,row)=>sum+Number(row.seconds),0),partyWorking:party.some(row=>Number(row.seconds)>0),partyGiftDiamonds:gift('PARTY'),
      // No canonical Party-valid-day, Board-completion or target source exists
      // in this schema. Unknown must not become an invented rule or zero.
      partyValidDays:null,partyBoardCompletedDays:null,partyBoardCompletedHours:null,targetStatus:'NOT_CONFIGURED'};
  });
}

export async function transferHostAgency(input:{scope:Scope;hostId:string;destinationAgencyId:string|null;reason:string;confirmed:boolean}) {
  if(input.scope.account.role!=='MASTER'||!input.confirmed) throw new Error('Master confirmation is required.');
  const reason=input.reason.trim(); if(reason.length<5||reason.length>500) throw new Error('Provide a reason of 5 to 500 characters.');
  return withTransaction(async connection=>{
    const [hosts]=await connection.query<RowDataPacket[]>(`SELECT h.id,h.application_user_id,h.agency_account_id
      FROM host_profiles h JOIN application_users u ON u.id=h.application_user_id WHERE h.id=? FOR UPDATE`,[input.hostId]);
    const host=hosts[0]; if(!host) throw new Error('Host was not found.');
    let destination:RowDataPacket|undefined;
    if(input.destinationAgencyId){
      const [agencies]=await connection.query<RowDataPacket[]>(`SELECT id,public_id,full_name FROM platform_accounts
        WHERE (id=? OR public_id=?) AND role='AGENCY' AND status='ACTIVE' AND removed_at IS NULL FOR UPDATE`,
        [input.destinationAgencyId,/^\d{6}$/.test(input.destinationAgencyId)?Number(input.destinationAgencyId):0]);
      destination=agencies[0]; if(!destination) throw new Error('Choose an active approved destination Agency.');
    }
    const next=destination?.id??null; if(host.agency_account_id===next) throw new Error('This is already the current Agency association.');
    await connection.execute('UPDATE application_users SET agency_account_id=? WHERE id=?',[next,host.application_user_id]);
    await connection.execute('UPDATE host_profiles SET agency_account_id=? WHERE id=?',[next,host.id]);
    await connection.execute(`INSERT INTO audit_logs (id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
      VALUES (?,?,'MASTER','host.agency_transfer','hosts','host',?,?,?,?)`,
      [randomUUID(),input.scope.account.id,host.id,JSON.stringify({agencyAccountId:host.agency_account_id}),JSON.stringify({agencyAccountId:next}),reason]);
    return {agencyId:destination?.public_id??null,agencyName:destination?.full_name??null};
  });
}
