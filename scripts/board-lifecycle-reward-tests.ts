import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {decodeJwt} from 'jose';
import type mysql from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import {withIdempotentTransaction as tx} from '@/lib/db/transaction';
import {checkpointHostLive} from '@/lib/services/live-auto-resume';
import {authorizeLiveKitRoom} from '@/lib/services/livekit-room-authority';
import {LiveKitTokenService} from '@/lib/services/livekit-token-service';
import {businessDateFor} from '@/lib/services/live-business-policy';
import {reconcileCheckpointedLiveRewards,claimLiveReward,claimAllLiveRewards} from '@/lib/db/repositories/mobile-completion';
import {repairMissingLiveRewardEntitlements} from '@/lib/db/repositories/live-accounting-diagnostics';
import type {Scope} from '@/types/platform';

export async function verifyBoardLifecycle(root:mysql.Connection,user:(name:string)=>Promise<MobileIdentity>,agencyId:string,master:Scope){
  await root.execute(`UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.hourlyRewardDiamonds',3500,'$.rewardBlockSeconds',1800,'$.timezone','Asia/Kolkata') WHERE setting_key='mobile.live_rules'`);
  async function host(name:string){const h=await user(name);await root.execute('UPDATE application_users SET agency_account_id=? WHERE id=?',[agencyId,h.userId]);await root.execute('UPDATE host_profiles SET agency_account_id=? WHERE application_user_id=?',[agencyId,h.userId]);return {...h,agencyAccountId:agencyId};}
  async function room(h:MobileIdentity,period=1800,type='FACE'){
    const id=randomUUID(),code=`board-${id}`,accounting=randomUUID();
    const [rules]=await root.query<mysql.RowDataPacket[]>("SELECT id FROM host_reward_rules WHERE room_type=? AND enabled=TRUE ORDER BY effective_from DESC LIMIT 1",[type]);
    await root.execute("INSERT INTO live_rooms(id,room_code,host_application_user_id,agency_account_id,room_type,started_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP(3))",[id,code,h.userId,agencyId,type]);
    await root.execute("INSERT INTO live_session_accounting(id,room_id,host_application_user_id,room_type,started_at,reward_rule_id,reward_period_seconds) VALUES (?,?,?,?,CURRENT_TIMESTAMP(3),?,?)",[accounting,id,h.userId,type,rules[0].id,period]);
    await root.execute("INSERT INTO live_room_members(room_id,application_user_id,room_role,media_role,muted) VALUES (?,?,'OWNER',?,FALSE)",[id,h.userId,type==='PARTY'?'PARTY_OWNER':'HOST']);
    return {id,code,accounting};
  }
  async function at(accounting:string,seconds:number){
    await root.execute(`UPDATE live_session_accounting SET media_segment_seconds=?,valid_media_seconds=?,eligible_seconds_committed=?,media_publishing=TRUE,last_media_evidence_at=CURRENT_TIMESTAMP(3),last_media_heartbeat_at=CURRENT_TIMESTAMP(3) WHERE id=?`,[seconds,seconds,seconds,accounting]);
    await Promise.all(Array.from({length:8},()=>tx(c=>reconcileCheckpointedLiveRewards(c,accounting))));
  }
  async function earned(h:MobileIdentity){const [r]=await root.query<mysql.RowDataPacket[]>('SELECT * FROM live_reward_entitlements WHERE application_user_id=? ORDER BY completed_hour',[h.userId]);return r;}
  const h=await host('Half-hour boundary Host'),r=await room(h);
  await at(r.accounting,1799);assert.equal((await earned(h)).length,0);
  await at(r.accounting,1800);let e=await earned(h);assert.equal(e.length,1);assert.equal(Number(e[0].amount),1750);assert.equal(e[0].claim_status,'UNCLAIMED');assert.equal(Number(e[0].reward_period_seconds),1800);
  await at(r.accounting,3599);assert.equal((await earned(h)).length,1);
  await at(r.accounting,3600);e=await earned(h);assert.equal(e.length,2);assert.deepEqual(e.map(x=>Number(x.amount)),[1750,1750]);
  const [before]=await root.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM ledger_transactions WHERE destination_id=?',[h.userId]);assert.equal(Number(before[0].n),0,'earned rewards never auto-credit');
  await Promise.all(Array.from({length:8},()=>claimLiveReward(h,String(e[0].id))));
  await Promise.all(Array.from({length:8},()=>claimAllLiveRewards(h)));
  await Promise.all(Array.from({length:32},()=>claimAllLiveRewards(h)));
  const [credits]=await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n,SUM(amount) amount FROM ledger_transactions WHERE destination_id=? AND transaction_type='HOST_HOURLY_DIAMONDS'",[h.userId]);
  assert.deepEqual([Number(credits[0].n),Number(credits[0].amount)],[2,3500]);
  console.log('PASS 29:59 / 30:00 / 59:59 / 60:00: 0 / 1750 / 1750 / 3500 claimable Diamonds; eight concurrent settlements/claims; exactly two ledger credits, no auto-credit');

  const concurrent=await host('Two-device daily cap'),a=await room(concurrent),b=await room(concurrent);
  await Promise.all([at(a.accounting,3600),at(b.accounting,3600)]);
  const daily=await earned(concurrent);assert.equal(daily.length,2);assert.equal(daily.reduce((s,x)=>s+Number(x.amount),0),3500);
  const [slots]=await root.query<mysql.RowDataPacket[]>('SELECT daily_block_index FROM live_daily_reward_awards WHERE application_user_id=? ORDER BY daily_block_index',[concurrent.userId]);assert.deepEqual(slots.map(x=>Number(x.daily_block_index)),[1,2]);
  console.log('PASS two-session/two-device contention: one daily budget, two unique slots, 3500 maximum');

  const legacy=await host('Historical full daily award'),old=await room(legacy,3600);
  await root.execute("INSERT INTO live_daily_reward_awards(id,application_user_id,business_date,live_session_accounting_id,completed_hour,amount) VALUES (?,?,?,?,1,3500)",[randomUUID(),legacy.userId,businessDateFor('Asia/Kolkata'),old.accounting]);
  const next=await room(legacy);await at(next.accounting,3600);assert.equal((await earned(legacy)).length,0,'historical full reward exhausts new budget');
  console.log('PASS historical 3500 daily award is retained and prevents additional 1750 awards');

  const bd=await host('Bangladesh male block eligibility'),br=await room(bd);
  await root.execute("UPDATE application_users SET gender='MALE',country_code='BD' WHERE id=?",[bd.userId]);
  await root.execute("INSERT INTO live_daily_reward_awards(id,application_user_id,business_date,live_session_accounting_id,completed_hour,amount) VALUES (?,?,?,?,1,3500)",[randomUUID(),bd.userId,businessDateFor('Asia/Kolkata',new Date(Date.now()-86400000)),br.accounting]);
  await at(br.accounting,3600);assert.equal((await earned(bd)).reduce((s,x)=>s+Number(x.amount),0),3500);
  console.log('PASS Bangladesh male Host receives two claimable blocks; previous-day full award does not suppress the current business day');

  const repairHost=await host('Repair half-hour snapshot'),repairRoom=await room(repairHost);await at(repairRoom.accounting,1800);
  await root.execute('DELETE FROM live_reward_entitlements WHERE application_user_id=?',[repairHost.userId]);
  await repairMissingLiveRewardEntitlements({scope:master,days:1,reason:'Isolated missing half-hour entitlement recovery fixture'});
  const repaired=await earned(repairHost);assert.equal(repaired.length,1);assert.equal(Number(repaired[0].amount),1750);assert.equal(Number(repaired[0].reward_period_seconds),1800);
  await repairMissingLiveRewardEntitlements({scope:master,days:1,reason:'Repeat isolated half-hour entitlement recovery fixture'});assert.equal((await earned(repairHost)).length,1);
  console.log('PASS missing entitlement repair preserves the 1800-second snapshot, amount and idempotency without wallet credit');

  // A completed first block survives expired recovery; only its incomplete tail resets.
  const interrupted=await host('Expired second-block Host'),ir=await room(interrupted);await at(ir.accounting,2520);
  await tx(c=>checkpointHostLive(c,{accountingId:ir.accounting,publishing:false,source:'HEARTBEAT',applicationInterrupted:true,applicationInstanceId:'a'.repeat(32)}));
  await root.execute('UPDATE live_session_interruptions SET disconnected_at=CURRENT_TIMESTAMP(3)-INTERVAL 181 SECOND,grace_expires_at=CURRENT_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE live_session_accounting_id=?',[ir.accounting]);
  await tx(c=>checkpointHostLive(c,{accountingId:ir.accounting,publishing:true,source:'HEARTBEAT',applicationInterrupted:false,applicationInstanceId:'a'.repeat(32)}));
  const [resumed]=await root.query<mysql.RowDataPacket[]>('SELECT media_segment_seconds,eligible_duration_seconds,valid_media_seconds FROM live_session_accounting WHERE id=?',[ir.accounting]);
  assert.equal(Number(resumed[0].media_segment_seconds),0);assert.equal(Number(resumed[0].eligible_duration_seconds),1800);assert.equal((await earned(interrupted)).length,1);
  console.log('PASS 181s expiry: first 1750 retained, only incomplete second-block progress reset; actual publishing history preserved');

  // Same application process: a transport repair is not an Auto Resume use.
  const transport=await host('Foreground transport repair'),transportRoom=await room(transport);
  await at(transportRoom.accounting,1380);
  await root.execute('UPDATE live_session_accounting SET application_instance_id=? WHERE id=?',['b'.repeat(32),transportRoom.accounting]);
  await tx(c=>checkpointHostLive(c,{accountingId:transportRoom.accounting,publishing:false,source:'PROVIDER'}));
  await root.execute('UPDATE live_session_interruptions SET disconnected_at=CURRENT_TIMESTAMP(3)-INTERVAL 60 SECOND,grace_expires_at=CURRENT_TIMESTAMP(3)+INTERVAL 120 SECOND WHERE live_session_accounting_id=?',[transportRoom.accounting]);
  await tx(c=>checkpointHostLive(c,{accountingId:transportRoom.accounting,publishing:true,source:'HEARTBEAT',applicationInstanceId:'b'.repeat(32)}));
  const [repair]=await root.query<mysql.RowDataPacket[]>('SELECT a.media_segment_seconds,d.successful_resumes FROM live_session_accounting a JOIN live_auto_resume_days d ON d.host_application_user_id=a.host_application_user_id WHERE a.id=?',[transportRoom.accounting]);
  assert.equal(Number(repair[0].media_segment_seconds),1380);assert.equal(Number(repair[0].successful_resumes),0);
  // A real application restart at 179 seconds is one successful restoration.
  await tx(c=>checkpointHostLive(c,{accountingId:transportRoom.accounting,publishing:false,source:'PROVIDER'}));
  await root.execute('UPDATE live_session_interruptions SET disconnected_at=CURRENT_TIMESTAMP(3)-INTERVAL 179 SECOND,grace_expires_at=CURRENT_TIMESTAMP(3)+INTERVAL 1 SECOND WHERE live_session_accounting_id=?',[transportRoom.accounting]);
  await tx(c=>checkpointHostLive(c,{accountingId:transportRoom.accounting,publishing:true,source:'HEARTBEAT',applicationInstanceId:'c'.repeat(32)}));
  const [restart]=await root.query<mysql.RowDataPacket[]>('SELECT a.media_segment_seconds,d.successful_resumes FROM live_session_accounting a JOIN live_auto_resume_days d ON d.host_application_user_id=a.host_application_user_id WHERE a.id=?',[transportRoom.accounting]);
  assert.equal(Number(restart[0].media_segment_seconds),1380);assert.equal(Number(restart[0].successful_resumes),1);
  console.log('PASS 60s foreground transport repair uses zero Auto Resumes; 179s application restart preserves progress and consumes exactly one; offline time excluded');

  const tokens=await host('Muted Host token recovery'),tr=await room(tokens),sessionA=randomUUID(),sessionB=randomUUID();
  for(const id of [sessionA,sessionB])await root.execute("INSERT INTO mobile_sessions(id,application_user_id,token_hash,expires_at) VALUES (?,?,?,CURRENT_TIMESTAMP(3)+INTERVAL 1 DAY)",[id,tokens.userId,id.replaceAll('-','').padEnd(64,'a')]);
  const caller={...tokens,sessionId:sessionA};
  const first=await authorizeLiveKitRoom(caller,{roomCode:tr.code,canPublish:true});
  await root.execute('UPDATE live_room_members SET muted=TRUE WHERE room_id=?',[tr.id]);
  const muted=await authorizeLiveKitRoom(caller,{roomCode:tr.code,canPublish:true,previousGrantId:first.publisherGrantId});assert.equal(muted.publishMode,'video_audio');assert.equal(muted.microphoneMuted,true);
  await root.execute('UPDATE live_room_members SET muted_by_staff=TRUE WHERE room_id=?',[tr.id]);
  const staff=await authorizeLiveKitRoom(caller,{roomCode:tr.code,canPublish:true,previousGrantId:muted.publisherGrantId});assert.equal(staff.publishMode,'video_only');
  const token=await new LiveKitTokenService('wss://qa.invalid','qa-key','not-a-production-secret-1234567890').issueRoomToken({roomId:tr.code,identity:tokens.publicId,participantName:'QA',publishMode:staff.publishMode,nazraaLiveRoom:true});
  const claims=decodeJwt(token.participantToken);assert.deepEqual((claims.video as {canPublishSources:string[]}).canPublishSources,['camera']);assert.equal((claims.roomConfig as {departureTimeout:number}).departureTimeout,240);
  await root.execute('UPDATE live_room_members SET muted_by_staff=FALSE WHERE room_id=?',[tr.id]);
  await authorizeLiveKitRoom({...tokens,sessionId:sessionB},{roomCode:tr.code,canPublish:true});
  await assert.rejects(authorizeLiveKitRoom(caller,{roomCode:tr.code,canPublish:true,previousGrantId:staff.publisherGrantId}),e=>(e as {accessCode:string}).accessCode==='LIVE_SESSION_REPLACED');
  const guest=await host('Muted accepted audio Guest');
  await root.execute("INSERT INTO live_room_members(room_id,application_user_id,room_role,media_role,muted) VALUES (?,?,'SPEAKER','AUDIO_GUEST',TRUE)",[tr.id,guest.userId]);
  const mutedGuest=await authorizeLiveKitRoom(guest,{roomCode:tr.code,canPublish:true});assert.equal(mutedGuest.publishMode,'audio_only');assert.equal(mutedGuest.microphoneMuted,true);
  await root.execute('UPDATE live_room_members SET muted_by_staff=TRUE WHERE room_id=? AND application_user_id=?',[tr.id,guest.userId]);
  assert.equal((await authorizeLiveKitRoom(guest,{roomCode:tr.code,canPublish:true})).publishMode,'none');
  await root.execute("UPDATE live_room_members SET media_role='PASSIVE_VIEWER',muted_by_staff=FALSE WHERE room_id=? AND application_user_id=?",[tr.id,guest.userId]);
  await assert.rejects(authorizeLiveKitRoom(guest,{roomCode:tr.code,canPublish:true}));
  console.log('PASS muted Host recovery; staff mute keeps video only; per-room departure=240 token; real second-session replacement denied to obsolete caller');
  console.log('PASS accepted Guest self-mute retains audio-only capability; staff mute revokes publishing; passive viewer cannot publish');
}
