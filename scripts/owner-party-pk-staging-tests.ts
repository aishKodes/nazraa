import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type mysql from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import type {Scope} from '@/types/platform';
import {sendGift} from '@/lib/db/repositories/mobile-product';
import {audioPkSnapshot} from '@/lib/db/repositories/audio-party-pk';
import {finalizePkSession,pkStreakSnapshot,claimRandomPkReward} from '@/lib/db/repositories/mobile-rewards';
import {leaderboardFor,mobileDailyRewardsSnapshot,claimDailyReward,refreshPkBattleState} from '@/lib/db/repositories/mobile-completion';
import {mobileLiveHistory} from '@/lib/db/repositories/mobile-live-history';
import {runMonthlyHostEarningsReset} from '@/lib/db/repositories/monthly-host-reset';
import {rankingPeriod} from '@/lib/policy/ranking-period';
import {giftSettlementPolicy} from '@/lib/policy/gift-settlement-policy';

export async function verifyOwnerPartyPkStaging(root:mysql.Connection,user:(name:string)=>Promise<MobileIdentity>,master:Scope){
  const [database]=await root.query<mysql.RowDataPacket[]>('SELECT DATABASE() name');
  assert.match(String(database[0].name),/^nazraa_mobile_qa_/,'Financial fixtures must never use production');
  const activation=new Date(Date.now()-86400000).toISOString();
  await root.beginTransaction();
  await root.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.gift_economy',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,[JSON.stringify({giftCoinUnits:100,receiverDiamondUnits:97,giftPlatformFeeBps:1500,platformFeeActivatedAt:activation}),master.account.id]);
  await root.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.owner_party_pk_update',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,[JSON.stringify({activatedAt:activation}),master.account.id]);
  // Isolate Gift/PK assertions from unrelated Rocket participation awards.
  await root.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.room_features',?,?) ON DUPLICATE KEY UPDATE setting_value=JSON_SET(setting_value,'$.rocketEnabled',CAST('false' AS JSON))`,[JSON.stringify({rocketEnabled:false}),master.account.id]);
  await root.commit();
  await root.execute("INSERT INTO gift_catalog(id,gift_key,name,category,coin_price,created_by) VALUES(?,'qa_stage_100','Staging Gift','Popular',100,?)",[randomUUID(),master.account.id]);
  async function wallet(h:MobileIdentity,asset='COIN'){
    const [r]=await root.query<mysql.RowDataPacket[]>('SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type=?',[h.userId,asset]);return Number(r[0]?.available_balance??0);
  }
  async function member(room:string,h:MobileIdentity,role='AUDIENCE',seat:number|null=null,media='PASSIVE_VIEWER'){
    await root.execute('INSERT INTO live_room_members(room_id,application_user_id,room_role,seat_index,media_role,muted) VALUES(?,?,?,?,?,TRUE)',[room,h.userId,role,seat,media]);
  }
  async function room(host:MobileIdentity,kind='FACE'){
    const id=randomUUID(),code='stage-'+id;
    await root.execute('INSERT INTO live_rooms(id,room_code,host_application_user_id,room_type,seat_count) VALUES(?,?,?,?,10)',[id,code,host.userId,kind]);
    await member(id,host,'OWNER',kind==='PARTY'?0:null,kind==='PARTY'?'PARTY_OWNER':'HOST');return {id,code};
  }
  async function pk(a:{id:string;code:string},b:{id:string;code:string},host:MobileIdentity,mode='Random'){
    const id=randomUUID();await root.execute("INSERT INTO live_pk_sessions(id,source_room_id,target_room_id,requested_by_application_user_id,status,mode,duration_minutes,started_at) VALUES(?,?,?,?,'ACTIVE',?,5,UTC_TIMESTAMP(3)-INTERVAL 1 SECOND)",[id,a.id,b.id,host.userId,mode]);return id;
  }
  async function gift(sender:MobileIdentity,r:{id:string;code:string},receiver:MobileIdentity,quantity=1,id=randomUUID(),all=false){
    return sendGift(sender,{clientGiftId:id,roomCode:r.code,giftId:'qa_stage_100',recipientPublicId:receiver.publicId,quantity,recipientMode:all?'ALL':'SINGLE'});
  }
  const cases:unknown[]=[];
  for(const context of ['PARTY','FACE','PARTY_PK','FACE_PK']){
    const sender=await user(context+' sender'),receiver=await user(context+' receiver'),r=await room(receiver,context.startsWith('PARTY')?'PARTY':'FACE');
    await member(r.id,sender);await root.execute("UPDATE wallet_balances SET available_balance=1000 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
    let audioId:string|undefined;
    if(context.endsWith('_PK')){
      const other=await user(context+' opponent'),o=await room(other,context==='PARTY_PK'?'PARTY':'FACE');
      if(context==='FACE_PK')await pk(r,o,receiver);
      else{audioId=randomUUID();await root.execute("INSERT INTO audio_pk_sessions(id,source_room_id,target_room_id,requested_by,mode,duration_minutes,status,started_at,ends_at,result_ends_at,expires_at) VALUES(?,?,?,?,'RANDOM',5,'ACTIVE',UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,UTC_TIMESTAMP(3)+INTERVAL 5 MINUTE,UTC_TIMESTAMP(3)+INTERVAL 6 MINUTE,UTC_TIMESTAMP(3)+INTERVAL 1 MINUTE)",[audioId,r.id,o.id,receiver.userId]);for(const board of [r,o])await root.execute('INSERT INTO audio_pk_room_links(room_id,session_id) VALUES(?,?)',[board.id,audioId]);}
    }
    const before=await wallet(receiver,'DIAMOND'),request=randomUUID();
    const receipts=await Promise.all(Array.from({length:6},()=>gift(sender,r,receiver,1,request)));
    assert.equal(await wallet(sender),900);assert.equal(await wallet(receiver,'DIAMOND'),before+85);
    assert.equal(receipts.filter(r=>!r.replayed).length,1);
    const [events]=await root.query<mysql.RowDataPacket[]>('SELECT * FROM live_room_gift_events WHERE room_id=?',[r.id]);assert.equal(events.length,1);
    assert.deepEqual([Number(events[0].coin_value),Number(events[0].diamond_value),Number(events[0].platform_fee),Number(events[0].platform_fee_bps),events[0].gift_context],[100,85,15,1500,context]);
    const [ledger]=await root.query<mysql.RowDataPacket[]>('SELECT transaction_type,amount FROM ledger_transactions WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata,\'$.giftTransactionId\'))=? ORDER BY transaction_type',[events[0].id]);
    assert.deepEqual(ledger.map(x=>[x.transaction_type,Number(x.amount)]),[['GIFT_PLATFORM_FEE',15],['GIFT_RECEIVE',85],['GIFT_SPEND',100]]);
    if(context==='FACE_PK'){const state=await refreshPkBattleState(receiver,r.code);assert.equal(state?.pkSession?.sourceScore,100);assert.equal(state?.pkSession?.sourceHost.viewerCount,1);}
    if(audioId){const state=await audioPkSnapshot(receiver,r.code);assert.equal(state.session?.redTotal,85);assert.equal(state.session?.red.host.receivedDiamonds,85);assert.equal(state.session?.red.host.receivedGiftValue,100);}
    cases.push({context,senderBefore:1000,senderAfter:900,gross:100,recipientNet:85,fee:15,events:1,ledgerRows:ledger.length});
  }
  const sender=await user('ALL sender'),recipients=await Promise.all(Array.from({length:4},(_,i)=>user('ALL seat '+i))),party=await room(recipients[0],'PARTY');
  for(let i=1;i<4;i++)await member(party.id,recipients[i],'SPEAKER',i+1,'RTC_SPEAKER');await member(party.id,sender);
  const departed=await user('Departed seat'),audience=await user('Audience excluded');await member(party.id,departed,'SPEAKER',1,'RTC_SPEAKER');await root.execute('UPDATE live_room_members SET left_at=CURRENT_TIMESTAMP(3) WHERE room_id=? AND application_user_id=?',[party.id,departed.userId]);await member(party.id,audience);
  await root.execute("UPDATE wallet_balances SET available_balance=1000 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
  const batch=randomUUID(),sent=await gift(sender,party,recipients[0],1,batch,true);await gift(sender,party,recipients[0],1,batch,true);
  assert.ok('recipientCount' in sent && 'totalNetDiamonds' in sent && 'totalPlatformFee' in sent && 'batchId' in sent);
  assert.equal(await wallet(sender),600);assert.equal(sent.recipientCount,4);assert.equal(sent.totalCoins,400);assert.equal(sent.totalNetDiamonds,340);assert.equal(sent.totalPlatformFee,60);
  for(const receiver of recipients)assert.equal(await wallet(receiver,'DIAMOND'),85);
  assert.equal(await wallet(departed,'DIAMOND'),0);assert.equal(await wallet(audience,'DIAMOND'),0);
  const [batchRows]=await root.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n,COUNT(DISTINCT receiver_application_user_id) recipients,SUM(platform_fee) fee FROM live_room_gift_events WHERE gift_batch_id=?',[sent.batchId]);assert.deepEqual([Number(batchRows[0].n),Number(batchRows[0].recipients),Number(batchRows[0].fee)],[4,4,60]);
  await assert.rejects(()=>gift(sender,party,recipients[0],2,batch,true),/already used/);
  await root.execute("UPDATE wallet_balances SET available_balance=399 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);const insufficient=randomUUID();await assert.rejects(()=>gift(sender,party,recipients[0],1,insufficient,true),/Not enough/);assert.equal(await wallet(sender),399);for(const receiver of recipients)assert.equal(await wallet(receiver,'DIAMOND'),85);
  console.log('PASS all Gift contexts: '+JSON.stringify(cases));
  console.log('PASS Party ALL: 4 occupied eligible seats; 1000→600; 340 net Diamonds; 60 fee; replay once; empty/departed/audience excluded; insufficient balance rolls entire batch back');

  // Face ALL retains its existing Host + accepted audio-Guest eligibility.
  const fa=await user('Face ALL Host'),fg=await user('Face ALL Guest'),fs=await user('Face ALL sender'),fr=await room(fa);
  await member(fr.id,fg,'SPEAKER',1,'AUDIO_GUEST');await root.execute('UPDATE live_room_members SET seat_session_id=? WHERE room_id=? AND application_user_id=?',[randomUUID(),fr.id,fg.userId]);await member(fr.id,fs);
  await root.execute("UPDATE wallet_balances SET available_balance=1000 WHERE owner_id=? AND asset_type='COIN'",[fs.userId]);
  const far=await gift(fs,fr,fa,1,randomUUID(),true);assert.ok('recipientCount' in far);assert.equal(far.recipientCount,2);assert.equal(await wallet(fs),800);assert.equal(await wallet(fg,'DIAMOND'),85);assert.equal(await wallet(fa,'DIAMOND'),85);
  // A storage/ledger failure after wallet updates must roll the entire Gift back.
  await root.query("CREATE TRIGGER qa_fee_failure BEFORE INSERT ON ledger_transactions FOR EACH ROW BEGIN IF NEW.transaction_type='GIFT_PLATFORM_FEE' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='QA ledger storage failure'; END IF; END");
  try {await assert.rejects(()=>gift(fs,fr,fa),/QA ledger storage failure/);} finally {await root.query('DROP TRIGGER qa_fee_failure');}
  assert.equal(await wallet(fs),800);assert.equal(await wallet(fa,'DIAMOND'),85);
  // A new occupant must not inherit the previous user's recipient total.
  const pkOwner=await user('Seat swap owner'),pkGuest=await user('Original recipient'),pkNew=await user('New occupant'),pkSender=await user('Seat swap sender'),pr=await room(pkOwner,'PARTY'),po=await room(await user('Seat swap opponent'),'PARTY');
  await member(pr.id,pkGuest,'SPEAKER',2,'RTC_SPEAKER');await member(pr.id,pkSender);
  const swapId=randomUUID();await root.execute("INSERT INTO audio_pk_sessions(id,source_room_id,target_room_id,requested_by,mode,duration_minutes,status,started_at,ends_at,result_ends_at,expires_at) VALUES(?,?,?,?,'RANDOM',5,'ACTIVE',UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,UTC_TIMESTAMP(3)+INTERVAL 5 MINUTE,UTC_TIMESTAMP(3)+INTERVAL 6 MINUTE,UTC_TIMESTAMP(3)+INTERVAL 1 MINUTE)",[swapId,pr.id,po.id,pkOwner.userId]);for(const r of [pr,po])await root.execute('INSERT INTO audio_pk_room_links(room_id,session_id) VALUES(?,?)',[r.id,swapId]);
  await gift(pkSender,pr,pkGuest,2);
  let snap=await audioPkSnapshot(pkOwner,pr.code);assert.equal(snap.session?.red.seats.find(s=>String(s.id)===pkGuest.publicId)?.receivedDiamonds,170);
  await root.execute('UPDATE live_room_members SET left_at=UTC_TIMESTAMP(3),seat_index=NULL WHERE room_id=? AND application_user_id=?',[pr.id,pkGuest.userId]);await member(pr.id,pkNew,'SPEAKER',2,'RTC_SPEAKER');snap=await audioPkSnapshot(pkOwner,pr.code);assert.equal(snap.session?.red.seats.find(s=>String(s.id)===pkNew.publicId)?.receivedDiamonds,0);assert.equal(snap.session?.redTotal,170);
  console.log('PASS Face ALL; ledger-failure rollback; muted Party PK recipient credited; replacement occupant receives no stale seat total');
  // floor(1 * .85) = 0: the positive-amount ledger cannot accept a zero credit.
  // The debit/event/fee retain the explicit zero-net snapshot instead.
  await root.execute("INSERT INTO gift_catalog(id,gift_key,name,category,coin_price,created_by) VALUES(?,'qa_stage_one','One Coin Gift','Popular',1,?)",[randomUUID(),master.account.id]);
  const tinySenderBefore=await wallet(fs),tinyNetBefore=await wallet(fa,'DIAMOND');
  const tiny=await sendGift(fs,{clientGiftId:randomUUID(),roomCode:fr.code,giftId:'qa_stage_one',recipientPublicId:fa.publicId,quantity:1});
  assert.equal(tiny.event?.diamondValue,0);assert.equal(tiny.event?.platformFee,1);assert.equal(await wallet(fs),tinySenderBefore-1);assert.equal(await wallet(fa,'DIAMOND'),tinyNetBefore);
  console.log('PASS one-Coin integer floor: debit 1 / net 0 / fee 1; no invalid zero-amount ledger insert');

  // Monthly queries are bounded by calendar IST, not UTC CURRENT_DATE.
  assert.equal(rankingPeriod('monthly',new Date('2026-10-31T18:29:59.999Z')).businessMonth,'2026-10');assert.equal(rankingPeriod('monthly',new Date('2026-10-31T18:30:00.000Z')).businessMonth,'2026-11');
  const histSender=await user('Month sender'),histHost=await user('Month receiver'),hr=await room(histHost);await member(hr.id,histSender);
  const october=await gift(histSender,hr,histHost),november=await gift(histSender,hr,histHost,2);
  for(const [item,date,day] of [[october,'2026-10-31 18:29:59.000','2026-10-31'],[november,'2026-10-31 18:30:00.000','2026-11-01']] as const){await root.execute('UPDATE live_room_gift_events SET created_at=?,business_date=? WHERE id=?',[date,day,item.event!.id]);await root.execute("UPDATE ledger_transactions SET created_at=? WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.giftTransactionId'))=?",[date,item.event!.id]);}
  const ranking=await leaderboardFor('monthly',new Date('2026-11-01T00:00:00Z'));
  assert.equal(ranking.topGifters.find((r:{user:{id:string}})=>r.user.id===histSender.publicId)?.score,200);
  assert.equal(ranking.topHosts.find((r:{user:{id:string}})=>r.user.id===histHost.publicId)?.score,170);
  const history=await mobileLiveHistory(histHost,{now:new Date('2026-11-01T00:00:00Z')});assert.equal(history.summary.receivedDiamonds,170);assert.equal(history.summary.receivedCoins,200);assert.equal(history.days.length,2);
  const oldHistory=await mobileLiveHistory(histHost,{now:new Date('2026-10-31T18:29:59Z')});assert.equal(oldHistory.summary.receivedDiamonds,85);
  const beforeReset=await wallet(histHost,'DIAMOND');await runMonthlyHostEarningsReset(new Date('2026-11-01T00:00:00+05:30'));assert.equal(await wallet(histHost,'DIAMOND'),beforeReset);
  console.log('PASS IST month rollover: October preserved; November sending 200 / receiving 170; old daily history remains; no wallet reset');

  const host=await user('Random PK reward Host'),opponent=await user('Random PK opponent'),giver=await user('PK gifting fixture'),a=await room(host),b=await room(opponent);await member(a.id,giver);
  await root.execute("UPDATE wallet_balances SET available_balance=1000000 WHERE owner_id=? AND asset_type='COIN'",[giver.userId]);
  for(const mode of ['Random','Invite/Friends','Classic PK','Random','Random']){
    const session=await pk(a,b,host,mode);
    // Separate nonoverlapping score windows without waiting out real rounds.
    await root.execute('UPDATE live_room_gift_events SET created_at=UTC_TIMESTAMP(3)-INTERVAL 1 HOUR WHERE room_id=?',[a.id]);
    const roundGift=await gift(giver,a,host,50);
    await assert.rejects(()=>finalizePkSession(host,{sessionId:session,completed:true}),/still in progress/);
    await root.execute('UPDATE live_pk_sessions SET started_at=UTC_TIMESTAMP(3)-INTERVAL 302 SECOND WHERE id=?',[session]);
    await root.execute('UPDATE live_room_gift_events SET created_at=UTC_TIMESTAMP(3)-INTERVAL 5 SECOND WHERE id=?',[roundGift.event!.id]);
    await finalizePkSession(host,{sessionId:session,completed:true});await finalizePkSession(host,{sessionId:session,completed:true});
  }
  const state=await pkStreakSnapshot(host);assert.equal(state.manualClaim,true);assert.equal(state.claims.length,1);assert.equal(state.claims[0].amount,5000);assert.equal(state.claims[0].status,'claimable');
  const beforeClaim=await wallet(host);assert.equal(beforeClaim,5000,'completion must not auto-credit');
  await assert.rejects(()=>claimRandomPkReward(opponent,state.claims[0].id),/unavailable/);
  await Promise.all(Array.from({length:8},()=>claimRandomPkReward(host,state.claims[0].id)));assert.equal(await wallet(host),beforeClaim+5000);
  const [credits]=await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n,SUM(amount) amount FROM ledger_transactions WHERE destination_id=? AND transaction_type='PK_STREAK_REWARD'",[host.userId]);assert.deepEqual([Number(credits[0].n),Number(credits[0].amount)],[1,5000]);
  const rewards=await mobileDailyRewardsSnapshot(host);assert.equal(rewards.dailyRewards.checkInVisible,false);assert.equal(rewards.pkStreak.claims[0].status,'claimed');await assert.rejects(()=>claimDailyReward(host),/no longer/);
  // Integer conservation, activation and legacy compatibility, including large values.
  for(const n of [1,2,99,100,500,1000,Number.MAX_SAFE_INTEGER]){const p=giftSettlementPolicy(n,{giftPlatformFeeBps:1500,platformFeeActivatedAt:activation},new Date());assert.equal(BigInt(p.netDiamonds)+BigInt(p.platformFee),BigInt(n));assert.equal(p.netDiamonds,Number(BigInt(n)*8500n/10000n));}
  assert.equal(giftSettlementPolicy(100,{giftCoinUnits:100,receiverDiamondUnits:97,platformFeeActivatedAt:'2999-01-01T00:00:00Z'},new Date()).netDiamonds,97);
  assert.throws(()=>giftSettlementPolicy(100,{platformFeeActivatedAt:'invalid'},new Date()),/configuration/);
  await root.execute("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.platformFeeActivatedAt','2999-01-01T00:00:00Z') WHERE setting_key='mobile.gift_economy'");
  const legacy=await gift(fs,fr,fa);assert.equal(legacy.event?.diamondValue,97);
  await root.execute("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.platformFeeActivatedAt',?) WHERE setting_key='mobile.gift_economy'",[activation]);
  await root.query(await readFile('db/migrations/0112_owner_gifting_random_pk.sql','utf8'));
  const [oldGift]=await root.query<mysql.RowDataPacket[]>('SELECT diamond_value,fee_policy_version FROM live_room_gift_events WHERE id=?',[legacy.event!.id]);assert.deepEqual([Number(oldGift[0].diamond_value),oldGift[0].fee_policy_version],[97,'LEGACY_RATIO']);
  console.log('PASS restart-safe migration replay; old 97-Diamond transaction unchanged after prospective policy activation; invalid activation rejected');
  console.log('PASS Random-only 3 wins / 5000 gross qualifying requirement / 5000 Coin manual claim; Friend and Classic excluded; repeated finalization and eight concurrent claims produce one credit; check-in hidden, Live reward response retained');
  return {partySender:pkSender,partyHost:pkOwner,partyRoomCode:pr.code,faceHost:fa,faceSender:fs,faceRoomCode:fr.code,rewardHost:host};
}
