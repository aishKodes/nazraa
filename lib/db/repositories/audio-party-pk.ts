import "server-only";
import { randomUUID,randomInt } from "node:crypto";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { withIdempotentTransaction } from "@/lib/db/transaction";
import { publishRoomRealtimeEvent } from "@/lib/services/room-realtime-events";
import { publicApiOrigin } from "@/lib/config/public-api-origin";
import { LiveKitRoomAdmin } from "@/lib/services/livekit-room-admin";

type Session = RowDataPacket & { id:string; source_room_id:string; target_room_id:string; status:string; duration_minutes:number; source_code:string; target_code:string; source_host:string; target_host:string; source_status:string; target_status:string; rematch_requested_by:string|null; ends_at:Date|null; result_ends_at:Date|null; expires_at:Date; server_now:Date };
const liveStatuses = ['ACTIVE','RESULT','REMATCH_PENDING'];
const sqlSession = `SELECT p.*,s.room_code source_code,t.room_code target_code,
 s.host_application_user_id source_host,t.host_application_user_id target_host,
 s.status source_status,t.status target_status,CURRENT_TIMESTAMP(3) server_now
 FROM audio_pk_sessions p JOIN live_rooms s ON s.id=p.source_room_id
 JOIN live_rooms t ON t.id=p.target_room_id`;

async function notify(p:Session) {
  await Promise.all([publishRoomRealtimeEvent(p.source_code,'pk'),publishRoomRealtimeEvent(p.target_code,'pk')]);
  if(['ENDED','REJECTED','EXPIRED'].includes(p.status)) {
    const media=new LiveKitRoomAdmin();
    await Promise.all([media.disconnectAudioPkBridges(p.source_code,p.id),media.disconnectAudioPkBridges(p.target_code,p.id)]);
  }
}
async function end(connection:PoolConnection,p:Session,status='ENDED') {
  await connection.execute(`UPDATE audio_pk_sessions SET status=?,ended_at=CURRENT_TIMESTAMP(3),version=version+1 WHERE id=? AND ended_at IS NULL`,[status,p.id]);
  await connection.execute('DELETE FROM audio_pk_room_links WHERE session_id=?',[p.id]);
  p.status=status;
}
async function reconcile(connection:PoolConnection,p:Session) {
  const now=new Date(p.server_now).getTime();
  if (!['ACTIVE','LOCKED'].includes(p.source_status)||!['ACTIVE','LOCKED'].includes(p.target_status)) {
    await end(connection,p); return;
  }
  if(p.status==='INVITED' && new Date(p.expires_at).getTime()<=now) await end(connection,p,'EXPIRED');
  if(p.status==='ACTIVE' && p.ends_at && new Date(p.ends_at).getTime()<=now){
    await connection.execute(`UPDATE audio_pk_sessions SET status='RESULT',version=version+1 WHERE id=? AND status='ACTIVE'`,[p.id]);
    p.status='RESULT';
  }
  if(['RESULT','REMATCH_PENDING'].includes(p.status)&&p.result_ends_at&&new Date(p.result_ends_at).getTime()<=now) await end(connection,p);
}
async function membership(connection:PoolConnection,identity:MobileIdentity,roomCode:string){
  const [rows]=await connection.query<RowDataPacket[]>(`SELECT r.id,r.room_code,r.host_application_user_id,r.pk_requests_enabled
   FROM live_rooms r JOIN live_room_members m ON m.room_id=r.id AND m.application_user_id=? AND m.left_at IS NULL
   WHERE r.room_code=? AND r.room_type='PARTY' AND r.status IN ('ACTIVE','LOCKED')`,[identity.userId,roomCode]);
  if(!rows[0])throw new Error('Join this active Party before using Audio PK.');
  return rows[0];
}
async function linked(connection:PoolConnection,roomId:string,includeTerminal=false){
  const [rows]=await connection.query<Session[]>(`${sqlSession} JOIN audio_pk_room_links l ON l.session_id=p.id WHERE l.room_id=? LIMIT 1 FOR UPDATE`,[roomId]);
  if(rows[0]){const status=rows[0].status;await reconcile(connection,rows[0]);rows[0].reconciled=status!==rows[0].status;}
  return rows[0] && (includeTerminal||!['ENDED','REJECTED','EXPIRED'].includes(rows[0].status))?rows[0]:null;
}
async function team(connection:PoolConnection,roomId:string){
  const [rows]=await connection.query<RowDataPacket[]>(`SELECT u.public_id id,u.full_name name,
   CASE WHEN a.updated_at IS NOT NULL THEN CONCAT(?,u.public_id,'?v=',FLOOR(UNIX_TIMESTAMP(a.updated_at)*1000)) ELSE u.avatar_url END avatarUrl,
   m.seat_index seatIndex,m.muted,m.media_role mediaRole,r.seat_count seatCount
   FROM live_rooms r JOIN application_users u ON u.id=r.host_application_user_id
   LEFT JOIN live_room_members m ON m.room_id=r.id AND m.application_user_id=u.id AND m.left_at IS NULL
   LEFT JOIN application_user_avatars a ON a.application_user_id=u.id WHERE r.id=?`,[`${publicApiOrigin()}/api/v1/mobile/avatar/`,roomId]);
  const [speakers]=await connection.query<RowDataPacket[]>(`SELECT u.public_id id,u.full_name name,
   CASE WHEN a.updated_at IS NOT NULL THEN CONCAT(?,u.public_id,'?v=',FLOOR(UNIX_TIMESTAMP(a.updated_at)*1000)) ELSE u.avatar_url END avatarUrl,
   m.seat_index seatIndex,m.muted,m.media_role mediaRole
   FROM live_room_members m JOIN application_users u ON u.id=m.application_user_id
   LEFT JOIN application_user_avatars a ON a.application_user_id=u.id
   WHERE m.room_id=? AND m.left_at IS NULL AND m.seat_index IS NOT NULL
   AND m.application_user_id<>(SELECT host_application_user_id FROM live_rooms WHERE id=?) ORDER BY m.seat_index LIMIT 4`,[`${publicApiOrigin()}/api/v1/mobile/avatar/`,roomId,roomId]);
  const [locks]=await connection.query<RowDataPacket[]>('SELECT seat_index FROM live_room_seat_locks WHERE room_id=?',[roomId]);
  const locked=new Set(locks.map(row=>Number(row.seat_index)));
  // Four real Party indices, never independent PK seats. Keep current speaker
  // ordering, fill vacancies from the same board and return canonical locks.
  const selected:RowDataPacket[]=speakers.map(member=>({...member,locked:locked.has(Number(member.seatIndex))}));
  for(let index=0;selected.length<4&&index<Number(rows[0].seatCount);index++){
    if(rows[0].seatIndex!=null&&Number(rows[0].seatIndex)===index || selected.some(member=>Number(member.seatIndex)===index))continue;
    selected.push({id:null,name:null,seatIndex:index,muted:true,locked:locked.has(index)} as RowDataPacket);
  }
  return {host:rows[0],seats:selected};
}
export async function audioPkSnapshot(identity:MobileIdentity,roomCode:string){
  let changed:Session|undefined;
  const snapshot=await withIdempotentTransaction(async c=>{
    const room=await membership(c,identity,roomCode);
    const p=await linked(c,String(room.id),true);
    if(p?.reconciled)changed=p;
    if(!p||['ENDED','REJECTED','EXPIRED'].includes(p.status)) return {serverNow:new Date().toISOString(),session:null};
    const [top]=await c.query<RowDataPacket[]>(`SELECT u.public_id id,u.full_name name,u.avatar_url avatarUrl,SUM(g.diamonds) diamonds
      FROM audio_pk_gift_attributions g JOIN application_users u ON u.id=g.application_user_id
      WHERE g.session_id=? GROUP BY u.id,u.public_id,u.full_name,u.avatar_url ORDER BY diamonds DESC,u.public_id LIMIT 3`,[p.id]);
    return {serverNow:p.server_now,session:{id:p.id,status:p.status,mode:p.mode,durationMinutes:Number(p.duration_minutes),version:Number(p.version),
      sourceRoomCode:p.source_code,targetRoomCode:p.target_code,localTeam:String(room.id)===p.source_room_id?'RED':'BLUE',
      startedAt:p.started_at,endsAt:p.ends_at,resultEndsAt:p.result_ends_at,expiresAt:p.expires_at,
      redTotal:Number(p.red_total),blueTotal:Number(p.blue_total),
      canControl:room.host_application_user_id===identity.userId,
      canRespond:p.target_host===identity.userId,
      rematchRequestedBy:p.rematch_requested_by,
      rematchCanRespond:p.rematch_requested_by!=null&&p.rematch_requested_by!==identity.userId&&[p.source_host,p.target_host].includes(identity.userId),
      red:await team(c,p.source_room_id),blue:await team(c,p.target_room_id),top3:top}};
  });
  // Snapshots are read/reconciliation only; no unconditional WS feedback loop.
  if(changed)await notify(changed);
  return snapshot;
}
export async function audioPkCandidates(identity:MobileIdentity,roomCode:string){
  return withIdempotentTransaction(async c=>{
    const room=await membership(c,identity,roomCode);
    if(room.host_application_user_id!==identity.userId)throw new Error('Only the Party Host can invite another Board.');
    const [rows]=await c.query<RowDataPacket[]>(`SELECT r.room_code roomCode,r.title,u.public_id id,u.full_name name,u.avatar_url avatarUrl,
      EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_application_user_id=? AND f.followed_application_user_id=u.id) followed
      FROM live_rooms r JOIN application_users u ON u.id=r.host_application_user_id
      WHERE r.id<>? AND r.room_type='PARTY' AND r.status IN ('ACTIVE','LOCKED') AND r.pk_requests_enabled=TRUE
      AND u.account_status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM audio_pk_room_links l WHERE l.room_id=r.id)
      AND EXISTS(SELECT 1 FROM live_room_members m WHERE m.room_id=r.id AND m.application_user_id=u.id AND m.left_at IS NULL AND m.last_seen_at>=CURRENT_TIMESTAMP(3)-INTERVAL 60 SECOND)
      ORDER BY followed DESC,r.started_at DESC LIMIT 30`,[identity.userId,room.id]);
    return {items:rows};
  });
}
export async function audioPkInvite(identity:MobileIdentity,input:{roomCode:string;targetRoomCode?:string;mode:'FRIEND'|'RANDOM';durationMinutes:number;requestId:string}){
  if(![5,10,30].includes(input.durationMinutes))throw new Error('Choose 5, 10 or 30 minutes.');
  const p=await withIdempotentTransaction(async c=>{
    const room=await membership(c,identity,input.roomCode);
    if(room.host_application_user_id!==identity.userId||!room.pk_requests_enabled)throw new Error('Only the active Party Host can request PK.');
    const [prior]=await c.query<Session[]>(`${sqlSession} WHERE p.id=? FOR UPDATE`,[input.requestId]);
    if(prior[0]){if(prior[0].requested_by!==identity.userId||prior[0].source_room_id!==room.id)throw new Error('This request belongs to another Board.');return prior[0];}
    let target=input.targetRoomCode;
    if(input.mode==='RANDOM'){
      const [available]=await c.query<RowDataPacket[]>(`SELECT r.room_code FROM live_rooms r
       WHERE r.room_type='PARTY' AND r.id<>? AND r.status IN ('ACTIVE','LOCKED') AND r.pk_requests_enabled=TRUE
       AND NOT EXISTS(SELECT 1 FROM audio_pk_room_links l WHERE l.room_id=r.id)
       AND EXISTS(SELECT 1 FROM live_room_members m WHERE m.room_id=r.id AND m.application_user_id=r.host_application_user_id AND m.left_at IS NULL AND m.last_seen_at>=CURRENT_TIMESTAMP(3)-INTERVAL 60 SECOND)
       ORDER BY r.started_at DESC LIMIT 30`,[room.id]);
      target=available.length?available[randomInt(available.length)].room_code:undefined;
    }
    if(!target)throw new Error('No available Party Host was found. Your Board remains open.');
    // Lock both base rooms in consistent order, not their media sessions.
    const [boards]=await c.query<RowDataPacket[]>(`SELECT id,room_code,host_application_user_id,pk_requests_enabled,status,room_type
      FROM live_rooms WHERE room_code IN (?,?) ORDER BY id FOR UPDATE`,[input.roomCode,target]);
    if(boards.length!==2||boards.some(r=>r.room_type!=='PARTY'||!r.pk_requests_enabled||!['ACTIVE','LOCKED'].includes(r.status)))throw new Error('Choose another available Party Board.');
    for(const board of boards)if(await linked(c,String(board.id)))throw new Error('One Board already has a PK invitation or battle.');
    const opponent=boards.find(r=>r.room_code===target)!;
    if(opponent.host_application_user_id===identity.userId)throw new Error('Choose another Party Host.');
    const [availableHost]=await c.query<RowDataPacket[]>(`SELECT u.id FROM application_users u JOIN live_room_members m ON m.application_user_id=u.id
      WHERE u.id=? AND u.account_status='ACTIVE' AND m.room_id=? AND m.left_at IS NULL AND m.last_seen_at>=CURRENT_TIMESTAMP(3)-INTERVAL 60 SECOND`,[opponent.host_application_user_id,opponent.id]);
    if(!availableHost.length)throw new Error('This Party Host is not available right now. Your Board remains open.');
    await c.execute(`INSERT INTO audio_pk_sessions(id,source_room_id,target_room_id,requested_by,mode,duration_minutes,expires_at)
     VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP(3)+INTERVAL 60 SECOND)`,[input.requestId,room.id,opponent.id,identity.userId,input.mode,input.durationMinutes]);
    for(const id of [String(room.id),String(opponent.id)].sort())await c.execute('INSERT INTO audio_pk_room_links(room_id,session_id) VALUES(?,?)',[id,input.requestId]);
    const [created]=await c.query<Session[]>(`${sqlSession} WHERE p.id=?`,[input.requestId]);return created[0];
  });
  await notify(p); return {id:p.id,status:p.status};
}
export async function audioPkAction(identity:MobileIdentity,input:{roomCode:string;sessionId:string;action:'ACCEPT'|'DECLINE'|'END'|'REMATCH'|'REMATCH_ACCEPT'|'REMATCH_DECLINE'}){
  const p=await withIdempotentTransaction(async c=>{
    const room=await membership(c,identity,input.roomCode);
    const [rows]=await c.query<Session[]>(`${sqlSession} WHERE p.id=? FOR UPDATE`,[input.sessionId]);const p=rows[0];
    if(!p||![p.source_room_id,p.target_room_id].includes(String(room.id))||room.host_application_user_id!==identity.userId)throw new Error('Only the battling Party Hosts can control this PK.');
    await reconcile(c,p);
    if(['ENDED','REJECTED','EXPIRED'].includes(p.status))return p;
    if(input.action==='END'){await end(c,p);return p;}
    if(input.action==='ACCEPT'||input.action==='DECLINE'){
      if(p.target_host!==identity.userId)throw new Error('Only the invited Host can respond.');
      if(p.status!=='INVITED')return p;
      if(input.action==='DECLINE'){await end(c,p,'REJECTED');return p;}
      await c.execute(`UPDATE audio_pk_sessions SET status='ACTIVE',started_at=CURRENT_TIMESTAMP(3),ends_at=CURRENT_TIMESTAMP(3)+INTERVAL duration_minutes MINUTE,
       result_ends_at=CURRENT_TIMESTAMP(3)+INTERVAL duration_minutes MINUTE+INTERVAL 20 SECOND,version=version+1 WHERE id=?`,[p.id]);p.status='ACTIVE';return p;
    }
    if(!['RESULT','REMATCH_PENDING'].includes(p.status))throw new Error('Rematch is available during the result phase.');
    if(input.action==='REMATCH'){
      if(p.status==='RESULT')await c.execute(`UPDATE audio_pk_sessions SET status='REMATCH_PENDING',rematch_requested_by=?,version=version+1 WHERE id=?`,[identity.userId,p.id]);
    }else{
      if(p.status!=='REMATCH_PENDING'||p.rematch_requested_by===identity.userId)throw new Error('Only the opponent can answer this rematch.');
      if(input.action==='REMATCH_DECLINE'){await end(c,p);return p;}
      // Lock old row until both links atomically point to the new instance.
      const id=randomUUID();
      await c.execute(`INSERT INTO audio_pk_sessions(id,source_room_id,target_room_id,requested_by,mode,duration_minutes,status,expires_at,started_at,ends_at,result_ends_at,parent_session_id)
       VALUES(?,?,?,?,?,?,'ACTIVE',CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3)+INTERVAL ? MINUTE,CURRENT_TIMESTAMP(3)+INTERVAL ? MINUTE+INTERVAL 20 SECOND,?)`,[id,p.source_room_id,p.target_room_id,identity.userId,p.mode,p.duration_minutes,p.duration_minutes,p.duration_minutes,p.id]);
      await end(c,p);
      for(const roomId of [p.source_room_id,p.target_room_id].sort())await c.execute('INSERT INTO audio_pk_room_links(room_id,session_id) VALUES(?,?)',[roomId,id]);
    }
    return p;
  });await notify(p);return audioPkSnapshot(identity,input.roomCode);
}
/** Called inside the existing atomic Gift transaction. One event = one attribution. */
export async function recordAudioPkGift(c:PoolConnection,input:{roomId:string;giftEventId:string;senderUserId:string;diamonds:number}){
  const [rows]=await c.query<Session[]>(`${sqlSession} JOIN audio_pk_room_links l ON l.session_id=p.id
   WHERE l.room_id=? AND p.status='ACTIVE' AND p.ends_at>CURRENT_TIMESTAMP(3) FOR UPDATE`,[input.roomId]);
  const p=rows[0];if(!p)return;
  const team=input.roomId===p.source_room_id?'RED':'BLUE';
  const [insert]=await c.execute<ResultSetHeader>(`INSERT IGNORE INTO audio_pk_gift_attributions(gift_event_id,session_id,application_user_id,team,diamonds) VALUES(?,?,?,?,?)`,[input.giftEventId,p.id,input.senderUserId,team,input.diamonds]);
  if(insert.affectedRows)await c.execute(`UPDATE audio_pk_sessions SET ${team==='RED'?'red_total':'blue_total'}=${team==='RED'?'red_total':'blue_total'}+?,version=version+1 WHERE id=?`,[input.diamonds,p.id]);
  return {roomCodes:[p.source_code,p.target_code]};
}
export async function authorizeAudioPkBridge(identity:MobileIdentity,input:{roomCode:string;sessionId:string}){
  return withIdempotentTransaction(async c=>{
    const room=await membership(c,identity,input.roomCode);const p=await linked(c,String(room.id));
    if(!p||p.id!==input.sessionId||!liveStatuses.includes(p.status))throw new Error('This Audio PK is no longer connected.');
    const other=String(room.id)===p.source_room_id?p.target_room_id:p.source_room_id;
    const remote=await team(c,other);
    const [speakers]=await c.query<RowDataPacket[]>(`SELECT u.public_id id FROM live_room_members m JOIN application_users u ON u.id=m.application_user_id
      WHERE m.room_id=? AND m.left_at IS NULL AND (m.media_role='PARTY_OWNER' OR (m.media_role='RTC_SPEAKER' AND m.seat_index IS NOT NULL))`,[other]);
    return {remoteRoomId:other===p.source_room_id?p.source_code:p.target_code,remoteHostId:String(remote.host.id),
      speakerIds:speakers.map(u=>String(u.id)),bridgeIdentity:`apk:${p.id}:${identity.publicId}`};
  });
}
export async function maintainAudioPk(){
  const [links]=await db().query<RowDataPacket[]>(`${sqlSession} WHERE p.status IN ('INVITED','ACTIVE','RESULT','REMATCH_PENDING') AND
   ((p.status='INVITED' AND p.expires_at<CURRENT_TIMESTAMP(3)) OR (p.status='ACTIVE' AND p.ends_at<CURRENT_TIMESTAMP(3)) OR
    (p.status IN ('RESULT','REMATCH_PENDING') AND p.result_ends_at<CURRENT_TIMESTAMP(3)) OR s.status NOT IN ('ACTIVE','LOCKED') OR t.status NOT IN ('ACTIVE','LOCKED')) LIMIT 100`);
  for(const row of links){
    const p=await withIdempotentTransaction(async c=>{const [rows]=await c.query<Session[]>(`${sqlSession} WHERE p.id=? FOR UPDATE`,[row.id]);await reconcile(c,rows[0]);return rows[0];});
    if(p.status!==row.status)await notify(p);
  }
  const [ended]=await db().query<Session[]>(`${sqlSession} WHERE p.ended_at>=CURRENT_TIMESTAMP(3)-INTERVAL 5 MINUTE LIMIT 100`);
  const media=new LiveKitRoomAdmin();
  for(const p of ended)await Promise.all([media.disconnectAudioPkBridges(p.source_code,p.id),media.disconnectAudioPkBridges(p.target_code,p.id)]);
}
