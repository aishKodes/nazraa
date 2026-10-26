import "server-only";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopeWhere, monitoringScopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";
import { mobilePartyBoardHistory } from "@/lib/db/repositories/party-board-history";

/** Master read-only projection: current wallets are separate from saved USD
 * payout snapshots. Never convert Coins into Diamonds or reprice history. */
export async function agencyOperationalTotals(scope:Scope,agencyIds:string[]) {
  if(scope.account.role!=='MASTER')throw new Error('Only Master may read this global financial view.');
  const ids=[...new Set(agencyIds)].slice(0,50);if(!ids.length)return [];
  const places=ids.map(()=>'?').join(',');
  const [rows]=await db().query<RowDataPacket[]>(`SELECT a.id,p.public_id admin_id,p.full_name admin_name,
    sp.public_id super_admin_id,sp.full_name super_admin_name,
    COALESCE(w.users,0) users,COALESCE(w.hosts,0) hosts,COALESCE(w.coins,0) coins,COALESCE(w.diamonds,0) diamonds,
    COALESCE(w.reserved_diamonds,0) reserved_diamonds,COALESCE(pay.submitted_diamonds,0) submitted_diamonds,
    COALESCE(pay.host_paid_usd,0) host_paid_usd,COALESCE(pay.host_pending_usd,0) host_pending_usd,
    COALESCE(pay.agency_paid_usd,0) agency_paid_usd,COALESCE(pay.agency_pending_usd,0) agency_pending_usd
    FROM platform_accounts a LEFT JOIN platform_accounts p ON p.id=a.parent_account_id
    LEFT JOIN platform_accounts sp ON sp.id=p.parent_account_id
    LEFT JOIN (
      SELECT COALESCE(owned.id,u.agency_account_id) agency_id,COUNT(*) users,SUM(u.is_host=TRUE) hosts,
        SUM(COALESCE(c.available_balance,0)) coins,SUM(COALESCE(d.available_balance,0)) diamonds,SUM(COALESCE(d.reserved_balance,0)) reserved_diamonds
      FROM application_users u LEFT JOIN platform_accounts owned ON owned.application_user_id=u.id AND owned.role='AGENCY' AND owned.status='ACTIVE' AND owned.removed_at IS NULL
      LEFT JOIN wallet_balances c ON c.owner_type='APPLICATION_USER' AND c.owner_id=u.id AND c.asset_type='COIN'
      LEFT JOIN wallet_balances d ON d.owner_type='APPLICATION_USER' AND d.owner_id=u.id AND d.asset_type='DIAMOND'
      WHERE COALESCE(owned.id,u.agency_account_id) IN (${places}) GROUP BY COALESCE(owned.id,u.agency_account_id)
    ) w ON w.agency_id=a.id
    LEFT JOIN (
      SELECT s.agency_account_id,SUM(IF(r.status IN ('APPROVED','PROCESSING','COMPLETED'),r.amount,0)) submitted_diamonds,
        SUM(IF(r.status='COMPLETED',s.host_usd,0)) host_paid_usd,
        SUM(IF(r.status IN ('APPROVED','PROCESSING'),s.host_usd,0)) host_pending_usd,
        SUM(IF(s.agency_paid_at IS NOT NULL AND s.agency_reversed_at IS NULL,s.agency_usd,0)) agency_paid_usd,
        SUM(IF(r.status IN ('APPROVED','PROCESSING','COMPLETED') AND (s.agency_paid_at IS NULL OR s.agency_reversed_at IS NOT NULL),s.agency_usd,0)) agency_pending_usd
      FROM host_payout_snapshots s JOIN withdrawal_requests r ON r.id=s.withdrawal_id
      WHERE s.agency_account_id IN (${places}) GROUP BY s.agency_account_id
    ) pay ON pay.agency_account_id=a.id
    WHERE a.id IN (${places}) AND a.role='AGENCY'`,[...ids,...ids,...ids]);
  return rows.map(row=>({agencyId:String(row.id),adminId:row.admin_id==null?null:String(row.admin_id),adminName:row.admin_name as string|null,
    superAdminId:row.super_admin_id==null?null:String(row.super_admin_id),superAdminName:row.super_admin_name as string|null,
    users:Number(row.users),hosts:Number(row.hosts),coins:Number(row.coins),diamonds:Number(row.diamonds),reservedDiamonds:Number(row.reserved_diamonds),
    submittedDiamonds:Number(row.submitted_diamonds),hostPaidUsd:String(row.host_paid_usd),hostPendingUsd:String(row.host_pending_usd),agencyPaidUsd:String(row.agency_paid_usd),agencyPendingUsd:String(row.agency_pending_usd)}));
}

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
  // Match mobileLiveHistory's existing canonical Face Valid Day threshold.
  const configuredMinimum=Number(rules[0][0]?.minimum_eligible_seconds??3600);
  const threshold=Math.max(60,configuredMinimum===1800?3600:configuredMinimum);
  // Reuse the SAME attendance ledger and existing 50-minute / 20-hour / 24-day
  // company summary that the Host's Party Board history uses. Do not infer
  // board attendance from owning a Party room or receiving gifts.
  const boardSummaries=await Promise.all(users.map(async user=>({userId:String(user.id),history:await mobilePartyBoardHistory({userId:String(user.id)})})));
  return users.map(user=>{
    const activity=days[0].filter(row=>row.host_application_user_id===user.id);
    const face=activity.filter(row=>row.mode==='FACE'),party=activity.filter(row=>row.mode==='PARTY');
    const gift=(mode:string)=>Number(gifts[0].find(row=>row.user_id===user.id&&row.mode===mode)?.diamonds??0);
    return {userId:String(user.id),publicId:String(user.public_id),name:String(user.full_name),avatarUrl:user.avatar_url as string|null,
      status:String(user.status),agencyId:user.agency_id==null?null:String(user.agency_id),agencyName:user.agency_name as string|null,
      adminId:user.admin_id==null?null:String(user.admin_id),adminName:user.admin_name as string|null,
      coins:Number(user.coins),diamonds:Number(user.diamonds),faceSeconds:face.reduce((sum,row)=>sum+Number(row.seconds),0),
      faceValidDays:face.filter(row=>Number(row.seconds)>=threshold).length,
      faceWorking:face.some(row=>Number(row.seconds)>0),faceGiftDiamonds:gift('FACE'),
      partySeconds:party.reduce((sum,row)=>sum+Number(row.seconds),0),partyWorking:party.some(row=>Number(row.seconds)>0),partyGiftDiamonds:gift('PARTY'),
      partyBoard:boardSummaries.find(row=>row.userId===String(user.id))!.history.summary,
      partyBoardTimezone:boardSummaries.find(row=>row.userId===String(user.id))!.history.timezone,
      // No separately assigned Face target exists. Board targets come from
      // the canonical Party company summary above, never a new panel formula.
      targetStatus:'FACE_TARGET_NOT_CONFIGURED'};
  });
}

export async function transferHostAgency(input:{scope:Scope;hostId:string;destinationAgencyId:string|null;reason:string;confirmed:boolean;expectedAgencyId?:string|null}) {
  if(input.scope.account.role!=='MASTER'||!input.confirmed) throw new Error('Master confirmation is required.');
  const reason=input.reason.trim(); if(reason.length<5||reason.length>500) throw new Error('Provide a reason of 5 to 500 characters.');
  return withTransaction(async connection=>{
    // Use the same user → Host lock order as mobile apply/review. A concurrent
    // acceptance cannot leave a split relationship or be removed by a stale form.
    const [references]=await connection.query<RowDataPacket[]>('SELECT application_user_id FROM host_profiles WHERE id=?',[input.hostId]);
    if(!references[0]) throw new Error('Host was not found.');
    const [users]=await connection.query<RowDataPacket[]>('SELECT id,agency_account_id FROM application_users WHERE id=? FOR UPDATE',[references[0].application_user_id]);
    const [hosts]=await connection.query<RowDataPacket[]>('SELECT id,application_user_id,agency_account_id FROM host_profiles WHERE id=? FOR UPDATE',[input.hostId]);
    const host=hosts[0]; if(!host) throw new Error('Host was not found.');
    const current=host.agency_account_id??users[0]?.agency_account_id??null;
    if(input.expectedAgencyId!==undefined&&input.expectedAgencyId!==current){
      if(input.destinationAgencyId===null&&current===null) return {agencyId:null,agencyName:null,alreadyExisted:true};
      throw new Error('This Host’s Agency changed. Refresh the Host page before trying again.');
    }
    let destination:RowDataPacket|undefined;
    if(input.destinationAgencyId){
      const [agencies]=await connection.query<RowDataPacket[]>(`SELECT id,public_id,full_name FROM platform_accounts
        WHERE (id=? OR public_id=?) AND role='AGENCY' AND status='ACTIVE' AND removed_at IS NULL FOR UPDATE`,
        [input.destinationAgencyId,/^\d{6}$/.test(input.destinationAgencyId)?Number(input.destinationAgencyId):0]);
      destination=agencies[0]; if(!destination) throw new Error('Choose an active approved destination Agency.');
    }
    const next=destination?.id??null;
    if(host.agency_account_id===next&&users[0]?.agency_account_id===next) return {agencyId:destination?.public_id??null,agencyName:destination?.full_name??null,alreadyExisted:true};
    await connection.execute('UPDATE application_users SET agency_account_id=? WHERE id=?',[next,host.application_user_id]);
    await connection.execute('UPDATE host_profiles SET agency_account_id=? WHERE id=?',[next,host.id]);
    await connection.execute(`UPDATE agency_membership_applications SET status='REMOVED',
      ended_by=?,ended_at=CURRENT_TIMESTAMP(3),end_reason=?
      WHERE application_user_id=? AND status='APPROVED' AND (? IS NULL OR agency_account_id<>?)`,
      [input.scope.account.id,reason,host.application_user_id,next,next]);
    // A Master transfer resolves pending requests explicitly, never leaves an
    // invisible pending membership blocking the next legitimate application.
    await connection.execute(`UPDATE agency_membership_applications SET status='REJECTED',
      reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP(3),review_reason=?
      WHERE application_user_id=? AND status='PENDING'`,
      [input.scope.account.id,`Resolved by Master Agency reassignment: ${reason}`,host.application_user_id]);
    await connection.execute(`INSERT INTO audit_logs (id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
      VALUES (?,?,'MASTER','host.agency_transfer','hosts','host',?,?,?,?)`,
      [randomUUID(),input.scope.account.id,host.id,JSON.stringify({agencyAccountId:host.agency_account_id}),JSON.stringify({agencyAccountId:next}),reason]);
    await connection.execute(`INSERT INTO mobile_notifications (id,application_user_id,notification_type,title,message,action_target)
      VALUES (?,?,'AGENCY',?,?, 'agency')`,[randomUUID(),host.application_user_id,next?'Agency membership updated':'Agency membership ended',
      next?`Master linked your Host account to ${destination?.full_name}.`:'Master removed your Agency membership. You can apply again to the same or another eligible Agency.']);
    return {agencyId:destination?.public_id??null,agencyName:destination?.full_name??null};
  });
}
