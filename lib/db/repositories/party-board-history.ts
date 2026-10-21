import 'server-only';
import { randomUUID } from 'node:crypto';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import { db } from '@/lib/db/pool';
import {withTransaction} from '@/lib/db/transaction';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import {businessDateFor,loadFaceLiveRules} from '@/lib/services/live-business-policy';
import {partyBoardSummary,partyBoardTargets,splitPartyBoardInterval} from '@/lib/services/party-board-time';

function utc(value:Date|string):Date {return value instanceof Date?value:new Date(value.replace(' ','T')+(value.endsWith('Z')?'':'Z'));}

/** Called only by authorized seat/room lifecycle transactions, never a media
 * callback or client timer. Parts are persisted in the SAME closing transaction. */
export async function closePartyBoardSegments(connection:PoolConnection,roomId:string,userId?:string,reason='SEAT_ENDED',at?:Date,segmentId?:string) {
  const [rows]=await connection.query<RowDataPacket[]>(`SELECT id,application_user_id,started_at,business_timezone
    FROM party_board_seat_segments WHERE room_id=? AND ended_at IS NULL${userId?' AND application_user_id=?':''}${segmentId?' AND id=?':''} FOR UPDATE`,[roomId,...(userId?[userId]:[]),...(segmentId?[segmentId]:[])]);
  if(!rows.length)return;
  const [clock]=await connection.query<RowDataPacket[]>('SELECT CURRENT_TIMESTAMP(3) now');
  const end=at??utc(clock[0].now);
  for(const row of rows) {
    await connection.execute('UPDATE party_board_seat_segments SET ended_at=?,end_reason=? WHERE id=? AND ended_at IS NULL',[end,reason,row.id]);
    for(const part of splitPartyBoardInterval(utc(row.started_at),end,row.business_timezone)) {
      await connection.execute(`INSERT INTO party_board_segment_days(segment_id,application_user_id,business_date,eligible_milliseconds)
        VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE eligible_milliseconds=VALUES(eligible_milliseconds)`,[row.id,row.application_user_id,part.date,part.milliseconds]);
    }
  }
}

/** Catch durable terminal state from pre-existing moderation/worker paths.
 * Uses recorded room/member/seat-event timestamps, not the time of this read.
 * A stable seat through a media reconnect is deliberately never terminal. */
export async function reconcilePartyBoardTerminals(connection:PoolConnection,userId?:string,roomId?:string) {
  const [rows]=await connection.query<RowDataPacket[]>(`SELECT s.id,s.room_id,s.application_user_id,
    COALESCE(r.ended_at,m.left_at,IF(u.account_status<>'ACTIVE',u.updated_at,NULL),(SELECT MIN(t.created_at) FROM live_room_seat_transitions t
      WHERE t.seat_session_id=s.seat_session_id AND t.next_state='UNSEATED'),m.updated_at,s.started_at) terminal_at
    FROM party_board_seat_segments s JOIN live_rooms r ON r.id=s.room_id JOIN application_users u ON u.id=s.application_user_id
    LEFT JOIN live_room_members m ON m.room_id=s.room_id AND m.application_user_id=s.application_user_id
    WHERE s.active_key IS NOT NULL AND s.ended_at IS NULL${userId?' AND s.application_user_id=?':''}${roomId?' AND s.room_id=?':''}
      AND (r.status='ENDED' OR u.account_status<>'ACTIVE' OR m.left_at IS NOT NULL OR m.application_user_id IS NULL
        OR m.seat_index IS NULL OR NOT(m.seat_session_id <=> s.seat_session_id))`,[...(userId?[userId]:[]),...(roomId?[roomId]:[])]);
  for(const row of rows)await closePartyBoardSegments(connection,row.room_id,row.application_user_id,'AUTHORITATIVE_TERMINAL_RECONCILIATION',utc(row.terminal_at),row.id);
}

export async function beginPartyBoardSeat(connection:PoolConnection,roomId:string,userId:string,seatSessionId:string,seatIndex:number) {
  const [members]=await connection.query<RowDataPacket[]>(`SELECT r.host_application_user_id,r.title,u.is_host,u.account_status,
    m.seat_session_id,m.seat_index FROM live_rooms r JOIN application_users u ON u.id=?
    JOIN live_room_members m ON m.room_id=r.id AND m.application_user_id=u.id AND m.left_at IS NULL
    WHERE r.id=? AND r.room_type='PARTY' AND r.status IN ('ACTIVE','LOCKED')`,[userId,roomId]);
  const member=members[0];
  if(!member||!member.is_host||member.account_status!=='ACTIVE'||member.host_application_user_id===userId
    ||member.seat_session_id!==seatSessionId||Number(member.seat_index)!==seatIndex)return;
  const [existing]=await connection.query<RowDataPacket[]>('SELECT id,seat_session_id,board_owner_user_id FROM party_board_seat_segments WHERE room_id=? AND application_user_id=? AND ended_at IS NULL FOR UPDATE',[roomId,userId]);
  if(existing[0]?.seat_session_id===seatSessionId&&existing[0]?.board_owner_user_id===member.host_application_user_id)return;
  await closePartyBoardSegments(connection,roomId,userId,'SEAT_REASSIGNED');
  const rules=await loadFaceLiveRules(connection);
  await connection.execute(`INSERT INTO party_board_seat_segments
    (id,application_user_id,board_owner_user_id,room_id,seat_session_id,seat_index,board_title,business_timezone)
    VALUES(?,?,?,?,?,?,?,?)`,[randomUUID(),userId,member.host_application_user_id,roomId,seatSessionId,seatIndex,member.title,rules.timezone]);
}

export async function reconcilePartyBoardOwner(connection:PoolConnection,roomId:string) {
  await closePartyBoardSegments(connection,roomId,undefined,'BOARD_OWNER_CHANGED');
  const [seats]=await connection.query<RowDataPacket[]>('SELECT application_user_id,seat_session_id,seat_index FROM live_room_members WHERE room_id=? AND left_at IS NULL AND seat_session_id IS NOT NULL AND seat_index IS NOT NULL',[roomId]);
  for(const seat of seats)await beginPartyBoardSeat(connection,roomId,seat.application_user_id,seat.seat_session_id,Number(seat.seat_index));
}

/** Attendance timeout requires BOTH stale authenticated presence and the
 * latest signed participant event being LEFT. Muting is never evidence of
 * absence; a participant JOINED event protects a still-connected muted seat.
 * This closes attendance only, never alters seats/RTC/media permissions. */
export async function expireAbsentPartyBoardSegments(connection:PoolConnection,userId?:string) {
  const [rows]=await connection.query<RowDataPacket[]>(`SELECT s.id,s.room_id,s.application_user_id,s.started_at,m.last_seen_at,
    (SELECT e.event_type FROM livekit_media_events e WHERE e.room_id=s.room_id AND e.application_user_id=s.application_user_id
      AND e.event_type IN ('participant_joined','participant_left') ORDER BY e.occurred_at DESC,e.received_at DESC LIMIT 1) participant_event,
    (SELECT e.occurred_at FROM livekit_media_events e WHERE e.room_id=s.room_id AND e.application_user_id=s.application_user_id
      AND e.event_type IN ('participant_joined','participant_left') ORDER BY e.occurred_at DESC,e.received_at DESC LIMIT 1) evidence_at,
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(features.setting_value,'$.mediaReconnectGraceSeconds')) AS UNSIGNED),180) grace_seconds,CURRENT_TIMESTAMP(3) now
    FROM party_board_seat_segments s JOIN live_room_members m ON m.room_id=s.room_id AND m.application_user_id=s.application_user_id
    LEFT JOIN system_settings features ON features.setting_key='mobile.room_features'
    WHERE s.active_key IS NOT NULL AND s.ended_at IS NULL${userId?' AND s.application_user_id=?':''}
      AND m.left_at IS NULL AND m.last_seen_at<CURRENT_TIMESTAMP(3)-INTERVAL 30 SECOND`,userId?[userId]:[]);
  for(const row of rows) {
    if(row.participant_event!=='participant_left'||!row.evidence_at)continue;
    const grace=Math.max(30,Math.min(300,Number(row.grace_seconds)))*1000;
    const cutoff=new Date(Math.max(utc(row.last_seen_at).getTime(),utc(row.evidence_at).getTime())+grace);
    if(cutoff<=utc(row.now)&&utc(row.started_at)<cutoff)await closePartyBoardSegments(connection,row.room_id,row.application_user_id,'AUTHORITATIVE_ABSENCE_TIMEOUT',cutoff,row.id);
  }
}

export async function maintainPartyBoardHistory() {
  await withTransaction(async connection=>{await reconcilePartyBoardTerminals(connection);await expireAbsentPartyBoardSegments(connection);});
}

export async function mobilePartyBoardHistory(identity:Pick<MobileIdentity,'userId'>,input:{before?:string;day?:string}={}) {
  for(const date of [input.before,input.day])if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Choose a valid history date.');
  const rules=await loadFaceLiveRules();
  await withTransaction(async connection=>{await reconcilePartyBoardTerminals(connection,identity.userId);await expireAbsentPartyBoardSegments(connection,identity.userId);});
  const [clock]=await db().query<RowDataPacket[]>('SELECT CURRENT_TIMESTAMP(3) now');
  const now=utc(clock[0].now),today=businessDateFor(rules.timezone,now);
  const [daily,open]=await Promise.all([
    db().query<RowDataPacket[]>(`SELECT DATE_FORMAT(business_date,'%Y-%m-%d') date,SUM(eligible_milliseconds) milliseconds,COUNT(*) sessions
      FROM party_board_segment_days WHERE application_user_id=? GROUP BY business_date`,[identity.userId]),
    db().query<RowDataPacket[]>(`SELECT s.*,owner.public_id owner_public_id,owner.full_name owner_name FROM party_board_seat_segments s
      LEFT JOIN application_users owner ON owner.id=s.board_owner_user_id WHERE s.application_user_id=? AND s.ended_at IS NULL`,[identity.userId])]);
  const days=new Map<string,{date:string;milliseconds:number;sessions:number}>();
  for(const row of daily[0])days.set(row.date,{date:row.date,milliseconds:Number(row.milliseconds),sessions:Number(row.sessions)});
  for(const row of open[0])for(const part of splitPartyBoardInterval(utc(row.started_at),now,row.business_timezone)) {
    const day=days.get(part.date)??{date:part.date,milliseconds:0,sessions:0};day.milliseconds+=part.milliseconds;day.sessions++;days.set(part.date,day);
  }
  const all=[...days.values()].sort((a,b)=>b.date.localeCompare(a.date));
  const selected=all.filter(d=>d.date<(input.before??'9999-12-31')),page=selected.slice(0,30);
  let sessions:Record<string,unknown>[]=[];
  if(input.day) {
    const [closed]=await db().query<RowDataPacket[]>(`SELECT s.*,d.eligible_milliseconds,owner.public_id owner_public_id,owner.full_name owner_name
      FROM party_board_segment_days d JOIN party_board_seat_segments s ON s.id=d.segment_id
      LEFT JOIN application_users owner ON owner.id=s.board_owner_user_id
      WHERE d.application_user_id=? AND d.business_date=? ORDER BY s.started_at DESC`,[identity.userId,input.day]);
    sessions=[...closed,...open[0]].flatMap(row=>splitPartyBoardInterval(utc(row.started_at),row.ended_at?utc(row.ended_at):now,row.business_timezone)
      .filter(p=>p.date===input.day).map(p=>({id:row.id,roomTitle:row.board_title,ownerId:row.owner_public_id==null?null:String(row.owner_public_id),ownerName:row.owner_name??'Host',startedAt:p.start.toISOString(),endedAt:row.ended_at||p.end.getTime()<now.getTime()?p.end.toISOString():null,seconds:Math.floor(p.milliseconds/1000),active:!row.ended_at&&p.end.getTime()===now.getTime()})));
    sessions.sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
  }
  return {timezone:rules.timezone,serverNow:now.toISOString(),summary:partyBoardSummary(all,today),
    days:page.map(d=>({date:d.date,seconds:Math.floor(d.milliseconds/1000),sessionCount:d.sessions,validDay:d.milliseconds>=partyBoardTargets.dailySeconds*1000})),
    nextBefore:selected.length>30?page.at(-1)?.date:null,sessions};
}
