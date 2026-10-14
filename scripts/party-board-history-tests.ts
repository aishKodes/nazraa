import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';

export async function verifyPartyBoardHistory(root:Connection,user:(name:string)=>Promise<MobileIdentity>,owner:MobileIdentity) {
  const product=await import('@/lib/db/repositories/mobile-product');
  const rooms=await import('@/lib/db/repositories/mobile-completion');
  const seats=await import('@/lib/db/repositories/mobile-seats');
  const board=await import('@/lib/db/repositories/party-board-history');
  const time=await import('@/lib/services/party-board-time');
  const lives=await import('@/lib/db/repositories/mobile-live-history');
  const referenceOwner=owner;
  owner=await user('QA Dedicated Board Owner');
  const host=await user('QA Board Time Host'),code=`QA_BOARD_${randomUUID().slice(0,8)}`;
  await product.createRoom(owner,{roomCode:code,kind:'party',title:'QA Board Time',category:'Talk',language:'Hindi',privacy:'public',seatCount:20,themeIndex:0,themeEnabled:false});
  const [r]=await root.query<RowDataPacket[]>('SELECT id FROM live_rooms WHERE room_code=?',[code]);const roomId=r[0].id;
  await rooms.joinLiveRoom(host,code);
  const liveBefore=await lives.mobileLiveHistory(referenceOwner);
  const emptyLiveBefore=await lives.mobileLiveHistory(host);
  assert.deepEqual(emptyLiveBefore.days,[]);assert.equal(emptyLiveBefore.summary.videoSeconds,0);
  await seats.actOnRoomSeat(owner,{roomCode:code,action:'request',seatIndex:0});
  assert.equal((await board.mobilePartyBoardHistory(owner)).summary.totalSeconds,0,'Own board is excluded');
  async function segment(minutes:number,muted=false) {
    await seats.actOnRoomSeat(owner,{roomCode:code,action:'assign',seatIndex:3,targetPublicId:host.publicId});
    const [open]=await root.query<RowDataPacket[]>('SELECT id,seat_session_id FROM party_board_seat_segments WHERE room_id=? AND application_user_id=? AND ended_at IS NULL',[roomId,host.userId]);
    assert.equal(open.length,1);
    await root.execute('UPDATE party_board_seat_segments SET started_at=TIMESTAMPADD(MINUTE, -?,CURRENT_TIMESTAMP(3)) WHERE id=?',[minutes,open[0].id]);
    if(muted)await rooms.setRoomMemberMuted(owner,{roomCode:code,targetPublicId:host.publicId,muted:true});
    for(let n=0;n<3;n++)await rooms.refreshRoomPresence(host,code);
    await seats.actOnRoomSeat(owner,{roomCode:code,action:'assign',seatIndex:3,targetPublicId:host.publicId});
    const [still]=await root.query<RowDataPacket[]>('SELECT id,seat_session_id FROM party_board_seat_segments WHERE room_id=? AND application_user_id=? AND ended_at IS NULL',[roomId,host.userId]);
    assert.equal(still.length,1);assert.equal(still[0].id,open[0].id);assert.equal(still[0].seat_session_id,open[0].seat_session_id);
    await seats.actOnRoomSeat(host,{roomCode:code,action:'leave',seatSessionId:open[0].seat_session_id});
    const after=(await board.mobilePartyBoardHistory(host)).summary.totalSeconds;
    await seats.actOnRoomSeat(host,{roomCode:code,action:'leave'});
    assert.equal((await board.mobilePartyBoardHistory(host)).summary.totalSeconds,after,'Repeated leave does not add time');
  }
  await segment(2);await segment(8);await segment(10,true);
  let history=await board.mobilePartyBoardHistory(host);
  assert(history.summary.todaySeconds>=1200&&history.summary.todaySeconds<1203);
  assert.equal(history.summary.dailyCompleted,false);assert.equal(history.days[0].sessionCount,3);
  await segment(15);history=await board.mobilePartyBoardHistory(host);
  assert(history.summary.todaySeconds>=2100&&history.summary.todaySeconds<2104);assert.equal(history.days[0].validDay,false);
  await segment(15);history=await board.mobilePartyBoardHistory(host);
  assert.equal(history.days[0].validDay,true);assert.equal(history.summary.validDays,1);
  await segment(20);history=await board.mobilePartyBoardHistory(host);
  assert(history.summary.todaySeconds>=4200&&history.summary.todaySeconds<4206);assert.equal(history.summary.validDays,1);
  assert.equal(history.days[0].sessionCount,6);
  const detail=await board.mobilePartyBoardHistory({...host}, {day:history.days[0].date});
  assert.equal(detail.sessions.length,6);assert(detail.sessions.every(s=>s.ownerId===owner.publicId));
  assert.deepEqual((await board.mobilePartyBoardHistory({...host})).days,history.days,'Fresh identity/relogin reads same durable history');
  const cross=time.splitPartyBoardInterval(new Date('2026-10-01T18:20:00Z'),new Date('2026-10-01T18:40:00Z'),'Asia/Kolkata');
  assert.deepEqual(cross.map(p=>[p.date,p.milliseconds]),[['2026-10-01',600000],['2026-10-02',600000]]);
  const dates=Array.from({length:24},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,milliseconds:3000000}));
  const monthly=time.partyBoardSummary(dates,'2026-10-31');assert.equal(monthly.validDays,24);assert.equal(monthly.monthlySeconds,72000);assert.equal(monthly.monthlyCompleted,true);
  assert.equal(time.partyBoardSummary([{date:'2026-10-01',milliseconds:72000000}],'2026-10-31').monthlyCompleted,false,'Twenty hours alone is not 24 days');
  assert.equal(time.partyBoardSummary([{date:'2026-09-30',milliseconds:3000000}],'2026-10-01').validDays,0,'Month rollover is independent');
  assert.deepEqual(await lives.mobileLiveHistory(referenceOwner),liveBefore,'Party attendance cannot alter Live History or reward ledger');
  assert.deepEqual(await lives.mobileLiveHistory(host),emptyLiveBefore,'Party time must not appear as Face/Live time');
  // A real closed segment crossing midnight persists two business-date rows.
  const pool=await import('@/lib/db/pool');
  const connection=await pool.db().getConnection();
  try {
    const splitHost=await user('QA Midnight Board Host');await rooms.joinLiveRoom(splitHost,code);
    await seats.actOnRoomSeat(owner,{roomCode:code,action:'assign',seatIndex:5,targetPublicId:splitHost.publicId});
    const business=await import('@/lib/services/live-business-policy');
    const zone=(await business.loadFaceLiveRules()).timezone;
    const midnight=business.businessDayUtcRange(zone,new Date('2026-10-01T12:00:00Z')).endsAt;
    const start=new Date(midnight.getTime()-600000),end=new Date(midnight.getTime()+600000);
    await root.execute('UPDATE party_board_seat_segments SET started_at=? WHERE room_id=? AND application_user_id=? AND ended_at IS NULL',[start.toISOString().slice(0,23).replace('T',' '),roomId,splitHost.userId]);
    await connection.beginTransaction();
    await board.closePartyBoardSegments(connection,roomId,splitHost.userId,'QA_MIDNIGHT',end);
    await board.closePartyBoardSegments(connection,roomId,splitHost.userId,'QA_RETRY',end);
    await connection.commit();
    const [parts]=await root.query<RowDataPacket[]>("SELECT DATE_FORMAT(business_date,'%Y-%m-%d') date,eligible_milliseconds FROM party_board_segment_days WHERE application_user_id=? ORDER BY business_date",[splitHost.userId]);
    assert.deepEqual(parts.map(p=>[p.date,Number(p.eligible_milliseconds)]),[['2026-10-01',600000],['2026-10-02',600000]]);
    const pairedHost=await user('QA Two Twenty Five Host');await rooms.joinLiveRoom(pairedHost,code);
    for(let n=0;n<2;n++) {
      await seats.actOnRoomSeat(owner,{roomCode:code,action:'assign',seatIndex:6,targetPublicId:pairedHost.publicId});
      await root.execute('UPDATE party_board_seat_segments SET started_at=CURRENT_TIMESTAMP(3)-INTERVAL 25 MINUTE WHERE room_id=? AND application_user_id=? AND ended_at IS NULL',[roomId,pairedHost.userId]);
      await seats.actOnRoomSeat(pairedHost,{roomCode:code,action:'leave'});
    }
    const pairHistory=await board.mobilePartyBoardHistory(pairedHost);
    assert(pairHistory.summary.todaySeconds>=3000&&pairHistory.summary.todaySeconds<3003);assert.equal(pairHistory.summary.dailyCompleted,true);
    assert.equal(pairHistory.summary.validDays,1);assert.equal(pairHistory.days[0].sessionCount,2);
    // Timeout requires signed LEFT evidence + stale presence; muted JOINED
    // transport and a short reconnect do not destroy an attendance segment.
    const reconnectHost=await user('QA Attendance Reconnect');await rooms.joinLiveRoom(reconnectHost,code);
    await seats.actOnRoomSeat(owner,{roomCode:code,action:'assign',seatIndex:7,targetPublicId:reconnectHost.publicId});
    const [epoch]=await root.query<RowDataPacket[]>('SELECT id,seat_session_id FROM party_board_seat_segments WHERE application_user_id=? AND ended_at IS NULL',[reconnectHost.userId]);
    const evidence=async(event:string,ago:number)=>root.execute(`INSERT INTO livekit_media_events(id,provider_event_id,room_id,application_user_id,event_type,occurred_at,payload_sha256)
      VALUES(?,?,?,?,?,TIMESTAMPADD(SECOND,-?,CURRENT_TIMESTAMP(3)),?)`,[randomUUID(),randomUUID(),roomId,reconnectHost.userId,event,ago,'0'.repeat(64)]);
    await root.execute('UPDATE live_room_members SET last_seen_at=CURRENT_TIMESTAMP(3)-INTERVAL 2 MINUTE WHERE room_id=? AND application_user_id=?',[roomId,reconnectHost.userId]);
    await evidence('participant_left',100);
    await connection.beginTransaction();await board.expireAbsentPartyBoardSegments(connection,reconnectHost.userId);await connection.commit();
    assert.equal((await root.query<RowDataPacket[]>('SELECT id FROM party_board_seat_segments WHERE id=? AND ended_at IS NULL',[epoch[0].id]))[0].length,1,'Short reconnect grace preserves segment');
    await root.execute('UPDATE live_room_members SET last_seen_at=CURRENT_TIMESTAMP(3)-INTERVAL 10 MINUTE WHERE room_id=? AND application_user_id=?',[roomId,reconnectHost.userId]);
    await root.execute('UPDATE livekit_media_events SET occurred_at=CURRENT_TIMESTAMP(3)-INTERVAL 20 MINUTE WHERE application_user_id=? AND event_type=?',[reconnectHost.userId,'participant_left']);
    await evidence('participant_joined',500);
    await connection.beginTransaction();await board.expireAbsentPartyBoardSegments(connection,reconnectHost.userId);await connection.commit();
    assert.equal((await root.query<RowDataPacket[]>('SELECT id FROM party_board_seat_segments WHERE id=? AND ended_at IS NULL',[epoch[0].id]))[0].length,1,'Latest signed JOINED protects valid muted/publishing seat');
    await root.execute('UPDATE livekit_media_events SET occurred_at=CURRENT_TIMESTAMP(3)-INTERVAL 20 MINUTE WHERE application_user_id=? AND event_type=?',[reconnectHost.userId,'participant_left']);
    await evidence('participant_left',400);
    await root.execute('UPDATE party_board_seat_segments SET started_at=CURRENT_TIMESTAMP(3)-INTERVAL 20 MINUTE WHERE id=?',[epoch[0].id]);
    await connection.beginTransaction();await board.expireAbsentPartyBoardSegments(connection,reconnectHost.userId);await connection.commit();
    const [closedEpoch]=await root.query<RowDataPacket[]>('SELECT end_reason FROM party_board_seat_segments WHERE id=? AND ended_at IS NOT NULL',[epoch[0].id]);
    assert.equal(closedEpoch[0].end_reason,'AUTHORITATIVE_ABSENCE_TIMEOUT');
    const timeoutHistory=await board.mobilePartyBoardHistory(reconnectHost);
    await board.maintainPartyBoardHistory();await board.maintainPartyBoardHistory();
    assert.equal((await board.mobilePartyBoardHistory(reconnectHost)).summary.totalSeconds,timeoutHistory.summary.totalSeconds,'Worker retries do not add offline seconds');
    await rooms.joinLiveRoom(reconnectHost,code);await rooms.refreshRoomPresence(reconnectHost,code);
    const [resumed]=await root.query<RowDataPacket[]>('SELECT id,seat_session_id FROM party_board_seat_segments WHERE application_user_id=? AND ended_at IS NULL',[reconnectHost.userId]);
    assert.equal(resumed.length,1);assert.notEqual(resumed[0].id,epoch[0].id);assert.equal(resumed[0].seat_session_id,epoch[0].seat_session_id,'Attendance recovery preserves authoritative seat identity');
    const ownOnly=await board.mobilePartyBoardHistory(owner);assert.equal(ownOnly.summary.totalSeconds,0,'History cannot leak another seated Host');
  } finally {connection.release();}
  await seats.actOnRoomSeat(owner,{roomCode:code,action:'assign',seatIndex:4,targetPublicId:host.publicId});
  await rooms.kickRoomMember(owner,{roomCode:code,targetPublicId:host.publicId,reason:'Isolated history terminal test'});
  const [active]=await root.query<RowDataPacket[]>('SELECT id FROM party_board_seat_segments WHERE room_id=? AND application_user_id=? AND ended_at IS NULL',[roomId,host.userId]);assert.equal(active.length,0);
  await rooms.finalizeLiveSession(owner,code);
  assert.equal((await root.query<RowDataPacket[]>('SELECT id FROM party_board_seat_segments WHERE room_id=? AND ended_at IS NULL',[roomId]))[0].length,0);
  console.log('PASS Party Board History: own exclusion; other/muted short sessions; 2+8+10, 35/50/70m; stable reconnect/duplicate assignment; retry-safe leave; persisted date/session detail; midnight split; 24 valid days +20h; monthly rollover; unchanged Live History; terminal kick/end');
}
