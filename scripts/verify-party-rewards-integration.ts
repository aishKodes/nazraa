import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
async function main(){
 const database=`nazraa_party_rewards_qa_${Date.now()}`;
 const root=await mysql.createConnection({host:'127.0.0.1',user:'root',multipleStatements:true,timezone:'Z'});
 await root.query("SET time_zone='+00:00'");
 await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
 await root.query(`USE \`${database}\``);
 global.nazraaPool=mysql.createPool({host:'127.0.0.1',user:'root',database,connectionLimit:8,decimalNumbers:true,timezone:'Z',charset:'utf8mb4_unicode_ci'});
 global.nazraaInstrumentedPool=global.nazraaPool;
 const connections=await Promise.all(Array.from({length:8},()=>global.nazraaPool!.getConnection()));
 for(const c of connections){await c.query("SET time_zone='+00:00'");c.release();}
 try {
  for(const f of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())await root.query(await readFile(`db/migrations/${f}`,'utf8'));
  await (await import('@/lib/db/repositories/accounts')).createInitialMaster({publicId:100001,fullName:'Isolated QA Master',password:randomUUID()});
  await root.query(await readFile('db/migrations/0107_party_coin_rewards.sql','utf8'));
  await root.query("UPDATE host_reward_rules SET enabled=TRUE,effective_from='2000-01-01'");
  const {partyCoinReward}=await import('@/lib/db/repositories/party-coin-rewards');
  const policy=await import('@/lib/policy/party-coin-reward');
  const {partyMusic}=await import('@/lib/db/repositories/party-music');
  const {updateMobileProfile,setRoomAdmin,joinLiveRoom}=await import('@/lib/db/repositories/mobile-completion');
  const {partyRoomAdmins}=await import('@/lib/db/repositories/party-room-admins');
  const {createRoom}=await import('@/lib/db/repositories/mobile-product');
  async function user(name:string){const id=randomUUID();await root.execute("INSERT INTO application_users(id,external_user_id,full_name,gender,is_host) VALUES (?,?,?,'FEMALE',TRUE)",[id,id,name]);
   const [u]=await root.query<RowDataPacket[]>('SELECT public_id FROM application_users WHERE id=?',[id]);
   return {userId:id,publicId:String(u[0].public_id),externalUserId:id,fullName:name,role:'HOST',accountStatus:'ACTIVE',faceVerificationStatus:'VERIFIED',agencyFaceLiveAuthorized:true,hostAccessOverride:true,liveRestricted:false,temporaryLiveRestricted:false,hostingSuspended:false} as MobileIdentity;}
  const owner=await user('QA Owner'),viewer=await user('QA Reward Viewer');
  async function room(code:string){await createRoom(owner,{roomCode:code,kind:'party',title:'QA Music',category:'Talk',language:'en',privacy:'public',seatCount:10,themeIndex:0,themeEnabled:false});
    const [rows]=await root.query<RowDataPacket[]>('SELECT id FROM live_rooms WHERE room_code=?',[code]);return rows[0].id as string;}
  const code='QA_REWARD_ONE',roomId=await room(code);
  await joinLiveRoom(viewer,code);
  let state=await partyCoinReward(viewer,{action:'heartbeat',roomCode:code});assert.equal(state.eligibleSeconds,0);
  const day=state.rewardDay;
  async function accrue(seconds:number){for(let n=0;n<seconds;n+=20){await root.execute('UPDATE party_reward_clocks SET last_checkpoint_at=CURRENT_TIMESTAMP(3)-INTERVAL 20 SECOND WHERE application_user_id=?',[viewer.userId]);state=await partyCoinReward(viewer,{action:'heartbeat',roomCode:code});}}
  await accrue(300);assert(state.ready,JSON.stringify(state));assert.equal(state.intervalIndex,1);
  const requestId=randomUUID();
  const raced=await Promise.all(Array.from({length:12},()=>partyCoinReward({...viewer},{action:'claim',intervalIndex:1,requestId})));
  assert.equal(raced.filter(r=>'claimed'in r&&r.claimed===true).length,1,'Only one racing device credits');
  assert.equal(raced.filter(r=>'alreadyClaimed'in r&&r.alreadyClaimed===true).length,11);
  const [claims]=await root.query<RowDataPacket[]>('SELECT * FROM party_reward_claims WHERE application_user_id=?',[viewer.userId]);assert.equal(claims.length,1);
  assert(policy.partyRewardAmounts.includes(Number(claims[0].amount) as 20));
  const balance=async()=>Number((await root.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[viewer.userId]))[0][0].available_balance);
  assert.equal(await balance(),Number(claims[0].amount));
  await partyCoinReward(viewer,{action:'claim',intervalIndex:1,requestId:randomUUID()});assert.equal(await balance(),Number(claims[0].amount));
  await accrue(300);
  // An injected failure AFTER wallet/ledger writes must roll everything back.
  await root.query("CREATE TRIGGER qa_fail_reward BEFORE INSERT ON party_reward_claims FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='QA rollback'");
  const before=await balance();await assert.rejects(()=>partyCoinReward(viewer,{action:'claim',intervalIndex:2,requestId:randomUUID()}));assert.equal(await balance(),before);
  await root.query('DROP TRIGGER qa_fail_reward');
  for(let index=2;index<=5;index++){if(index>2)await accrue(300);const r=await partyCoinReward(viewer,{action:'claim',intervalIndex:index,requestId:randomUUID()});assert('claimed'in r&&r.claimed);}
  const completed=await partyCoinReward({...viewer},{action:'state'});assert.equal(completed.phase,'DAILY_COMPLETE');assert.equal(completed.claimsCompleted,5);
  const beforeSix=await balance();await partyCoinReward(viewer,{action:'claim',intervalIndex:5,requestId:randomUUID()});assert.equal(await balance(),beforeSix);
  const [count]=await root.query<RowDataPacket[]>('SELECT COUNT(*) count,SUM(amount) total FROM party_reward_claims WHERE application_user_id=?',[viewer.userId]);assert.equal(Number(count[0].count),5);assert.equal(Number(count[0].total),await balance());
  const second=await room('QA_REWARD_TWO');await joinLiveRoom(viewer,'QA_REWARD_TWO');
  assert.equal((await partyCoinReward({...viewer},{action:'heartbeat',roomCode:'QA_REWARD_TWO'})).claimsCompleted,5,'Room changes cannot reset cap');
  const fresh=await user('QA Offline');await joinLiveRoom(fresh,code);await partyCoinReward(fresh,{action:'heartbeat',roomCode:code});
  await root.execute('UPDATE party_reward_clocks SET last_checkpoint_at=CURRENT_TIMESTAMP(3)-INTERVAL 2 MINUTE WHERE application_user_id=?',[fresh.userId]);
  assert.equal((await partyCoinReward(fresh,{action:'heartbeat',roomCode:code})).eligibleSeconds,0,'Offline time excluded');
  await partyCoinReward(fresh,{action:'suspend',roomCode:code});assert.equal((await partyCoinReward(fresh,{action:'heartbeat',roomCode:code})).eligibleSeconds,0);
  const midnight=(await import('@/lib/services/party-board-time')).splitPartyBoardInterval(new Date('2026-10-18T18:29:50Z'),new Date('2026-10-18T18:30:10Z'),'Asia/Kolkata');
  assert.deepEqual(midnight.map(p=>[p.date,p.milliseconds]),[['2026-10-18',10000],['2026-10-19',10000]]);
  for(let i=0;i<4;i++)assert.equal(policy.pickPartyReward([1,1,1,1],()=>i),policy.partyRewardAmounts[i]);
  await setRoomAdmin(owner,{roomCode:code,targetPublicId:viewer.publicId,makeAdmin:true});
  await root.execute('UPDATE party_room_admins SET granted_at=CURRENT_TIMESTAMP(3)-INTERVAL 2 DAY WHERE room_id=?',[roomId]);
  assert.equal((await partyRoomAdmins(owner,code)).admins.length,1);
  await root.execute('UPDATE live_rooms SET status=\'ENDED\',ended_at=CURRENT_TIMESTAMP(3) WHERE id=?',[second]);
  const third=await room('QA_REWARD_THREE');assert.equal((await partyRoomAdmins(owner,'QA_REWARD_THREE')).admins.length,0,'Latest board without an assignment does not resurrect old grants');
  // Assign on latest board, restart and revoke an absent admin.
  await joinLiveRoom(viewer,'QA_REWARD_THREE');await setRoomAdmin(owner,{roomCode:'QA_REWARD_THREE',targetPublicId:viewer.publicId,makeAdmin:true});
  await root.execute("UPDATE live_rooms SET status='ENDED',ended_at=CURRENT_TIMESTAMP(3) WHERE id=?",[third]);
  const fourth=await room('QA_REWARD_FOUR');assert.equal((await partyRoomAdmins(owner,'QA_REWARD_FOUR')).admins.length,1);
  await setRoomAdmin(owner,{roomCode:'QA_REWARD_FOUR',targetPublicId:viewer.publicId,makeAdmin:false});assert.equal((await partyRoomAdmins(owner,'QA_REWARD_FOUR')).admins.length,0);
  await joinLiveRoom(viewer,'QA_REWARD_FOUR');
  assert.notEqual((await root.query<RowDataPacket[]>('SELECT room_role FROM live_room_members WHERE room_id=? AND application_user_id=?',[fourth,viewer.userId]))[0][0].room_role,'ADMIN');
  const input={displayName:'QA Edited Name',bio:'Edited only bio',countryCode:'IN',languageCode:'en',whatsappE164:'+919999999991'};
  await updateMobileProfile(viewer,{...input,gender:'PREFER_NOT_TO_SAY'});assert.equal((await root.query<RowDataPacket[]>('SELECT gender FROM application_users WHERE id=?',[viewer.userId]))[0][0].gender,'FEMALE');
  await updateMobileProfile(viewer,{...input,gender:'MALE',genderChangeConfirmed:true});
  const profile=await updateMobileProfile({...viewer},input);assert.equal(profile.profile.gender,'MALE');
  await joinLiveRoom(viewer,'QA_REWARD_FOUR');
  assert.equal((await partyMusic(owner,{roomCode:'QA_REWARD_FOUR',action:'search',query:'moonlit'})).catalog.length,1);
  await assert.rejects(()=>partyMusic(viewer,{roomCode:'QA_REWARD_FOUR',action:'play',trackId:'moonlit'}));
  assert((await partyMusic(owner,{roomCode:'QA_REWARD_FOUR',action:'play',trackId:'moonlit'})).state?.playing);
  assert.equal((await partyMusic(viewer,{roomCode:'QA_REWARD_FOUR',action:'state'})).state?.track?.id,'moonlit');
  assert.equal((await partyMusic(owner,{roomCode:'QA_REWARD_FOUR',action:'pause'})).state?.playing,false);
  assert((await partyMusic(owner,{roomCode:'QA_REWARD_FOUR',action:'resume'})).state?.playing);
  assert.equal((await partyMusic(owner,{roomCode:'QA_REWARD_FOUR',action:'play',trackId:'aurora'})).state?.track?.id,'aurora');
  assert.equal((await partyMusic(owner,{roomCode:'QA_REWARD_FOUR',action:'stop'})).state?.track,undefined);
  const cm=await user('QA Country Manager'),bd=await user('QA BD');
  for(const [person,role,publicId] of [[cm,'COUNTRY_MANAGER',100002],[bd,'BD',100003]] as const) {
    await root.execute("INSERT INTO platform_accounts(id,public_id,role,role_code,full_name,application_user_id,password_hash,status) VALUES (?,?,?,?,?,?,?,'ACTIVE')",[randomUUID(),publicId,role,`QA_${role}`,person.fullName,person.userId,'not-a-login-credential']);
  }
  const loadouts=await (await import('@/lib/db/repositories/mobile-cosmetics')).equippedCosmeticLoadoutsByPublicId([cm.publicId,bd.publicId,viewer.publicId]);
  assert.equal(loadouts.get(cm.publicId)?.ROLE_PRESENTATION?.itemId,'role_country_manager');
  assert.equal(loadouts.get(bd.publicId)?.ROLE_PRESENTATION,undefined);
  assert.equal(loadouts.get(viewer.publicId)?.ROLE_PRESENTATION,undefined);
  console.log('PASS: migration, first interval, allowed values, 12-way claim race, rollback, 5/day cap, retry, restart/room-change persistence, offline exclusion, midnight split, RNG boundaries, Admin >24h/recreate/revoke, gender preserve/explicit edit, music search/play/pause/resume/change/stop/auth.');
 } finally {
  await global.nazraaPool?.end();
  // This generated isolated localhost QA database only; never production.
  await root.query(`DROP DATABASE \`${database}\``);await root.end();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
