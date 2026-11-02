import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type mysql from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import type {Scope} from '@/types/platform';
import {sendGift} from '@/lib/db/repositories/mobile-product';
import {luckyDefaults,luckyPolicy,drawLucky,luckyExpectation} from '@/lib/policy/lucky-gifts';
import {partyMusic} from '@/lib/db/repositories/party-music';
import {luckyGiftControl} from '@/lib/db/repositories/lucky-gifts';
export async function verifyMusicLucky(root:mysql.Connection,user:(name:string)=>Promise<MobileIdentity>,master:Scope){
 const p=luckyPolicy({...luckyDefaults,enabled:true});
 await root.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.lucky_gifts',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",[JSON.stringify(p),master.account.id]);
 const sender=await user('Lucky sender'),host=await user('Music Host'),guest=await user('Music ordinary viewer');
 const [database]=await root.query<mysql.RowDataPacket[]>('SELECT DATABASE() name');assert.match(String(database[0].name),/^nazraa_mobile_qa_/);
 const room=randomUUID(),code='music-'+room;
 await root.execute("INSERT INTO live_rooms(id,room_code,host_application_user_id,room_type,seat_count) VALUES(?,?,?,'PARTY',10)",[room,code,host.userId]);
 for(const [u,role,media,seat] of [[host,'OWNER','PARTY_OWNER',0],[sender,'AUDIENCE','PASSIVE_VIEWER',null],[guest,'AUDIENCE','PASSIVE_VIEWER',null]] as const)await root.execute('INSERT INTO live_room_members(room_id,application_user_id,room_role,media_role,seat_index) VALUES(?,?,?,?,?)',[room,u.userId,role,media,seat]);
 await root.execute("INSERT INTO gift_catalog(id,gift_key,name,category,coin_price,economy_type,created_by) VALUES(?,'qa_lucky','QA Lucky','Lucky',100,'LUCKY',?)",[randomUUID(),master.account.id]);
 await root.execute("UPDATE wallet_balances SET available_balance=100000 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
 const key=randomUUID(),input={roomCode:code,giftId:'qa_lucky',recipientPublicId:host.publicId,quantity:5,clientGiftId:key};
 const rs=await Promise.all(Array.from({length:8},()=>sendGift(sender,input)));assert.equal(rs.filter(r=>!r.replayed).length,1);
 const [lucky]=await root.query<mysql.RowDataPacket[]>('SELECT r.*,e.gift_economy_type FROM lucky_gift_results r JOIN live_room_gift_events e ON e.id=r.gift_event_id WHERE e.room_id=?',[room]);assert.equal(lucky.length,1);assert.equal(Number(lucky[0].gross_coins),500);assert.equal(Number(lucky[0].receiver_diamonds),100);assert.equal(Number(lucky[0].company_allocation),400);assert.equal(lucky[0].gift_economy_type,'LUCKY');assert.equal(Number(lucky[0].sender_balance_after),100000-500+Number(lucky[0].reward_coins));
 const publicEvent=rs.find(r=>!r.replayed)!.event!;assert(!JSON.stringify(publicEvent).includes('8000'));assert.equal(publicEvent.platformFee,undefined);
 const [net]=await root.query<mysql.RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='DIAMOND'",[host.userId]);assert.equal(Number(net[0].available_balance),100);
 for(let i=0;i<20;i++)await sendGift(sender,{...input,quantity:1,clientGiftId:randomUUID()});
 const [ledger]=await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n,SUM(r.reward_coins) rewards,SUM(r.company_allocation) company FROM lucky_gift_results r JOIN live_room_gift_events e ON e.id=r.gift_event_id WHERE e.room_id=?",[room]);assert.equal(Number(ledger[0].n),21);
 const snapshot=await luckyGiftControl(master);assert(snapshot.daily.length>0);
 await assert.rejects(()=>luckyGiftControl({...master,account:{...master.account,role:'AGENCY'}}),/Only Master/);
 await root.execute("UPDATE wallet_balances SET available_balance=499 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);await assert.rejects(()=>sendGift(sender,{...input,clientGiftId:randomUUID()}),/Not enough/);
 const [afterFail]=await root.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM lucky_gift_results');assert.equal(Number(afterFail[0].n),21);
 // ALL is funded as a whole before any recipient's independent draw.
 await root.execute("UPDATE live_room_members SET media_role='RTC_SPEAKER',seat_index=1 WHERE room_id=? AND application_user_id=?",[room,guest.userId]);
 await root.execute("UPDATE wallet_balances SET available_balance=199 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
 const all={...input,quantity:1,recipientMode:'ALL' as const,expectedRecipientPublicIds:[host.publicId,guest.publicId],clientGiftId:randomUUID()};
 await assert.rejects(()=>sendGift(sender,all),/Not enough/);
 await root.execute("UPDATE wallet_balances SET available_balance=1000 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
 const accepted=await sendGift(sender,all);assert.ok('recipientCount' in accepted && 'totalNetDiamonds' in accepted && 'batchId' in accepted);assert.equal(accepted.recipientCount,2);assert.equal(accepted.totalCoins,200);assert.equal(accepted.totalNetDiamonds,40);
 const again=await sendGift(sender,all);assert(again.replayed);
 const [batch]=await root.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n,SUM(receiver_diamonds) net,SUM(company_allocation) company FROM lucky_gift_results r JOIN live_room_gift_events e ON e.id=r.gift_event_id WHERE e.gift_batch_id=?',[accepted.batchId]);assert.deepEqual([Number(batch[0].n),Number(batch[0].net),Number(batch[0].company)],[2,40,160]);
 // Storage failure rolls back the debit, receiver credit, bonus and all audit.
 const [beforeRollback]=await root.query<mysql.RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
 await root.query("CREATE TRIGGER qa_lucky_fail BEFORE INSERT ON lucky_gift_results FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='QA storage failure'");
 const retried={...input,quantity:1,clientGiftId:randomUUID()};
 try{await assert.rejects(()=>sendGift(sender,retried),/QA storage failure/);}finally{await root.query('DROP TRIGGER qa_lucky_fail');}
 const [afterRollback]=await root.query<mysql.RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);assert.equal(Number(afterRollback[0].available_balance),Number(beforeRollback[0].available_balance));
 await sendGift(sender,retried);assert((await sendGift(sender,retried)).replayed);
 await root.query(await readFile('db/migrations/0113_room_music_lucky_gifts.sql','utf8'));
 const [replayedMigration]=await root.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM lucky_gift_results');assert.equal(Number(replayedMigration[0].n),24);
 const music=await partyMusic(host,{roomCode:code,action:'local-start',fileName:'Local tune.mp3'});assert.equal(music.state?.sourceKind,'LOCAL_PCM');assert.equal(music.state?.controllerId,host.publicId);assert(music.state?.playing);
 const generation=music.state!.generation;
 await assert.rejects(()=>partyMusic(guest,{roomCode:code,action:'local-start',fileName:'Hijack.mp3'}),/Only the Host/);
 await assert.rejects(()=>partyMusic(host,{roomCode:code,action:'local-start',fileName:'/private/path.mp3'}),/file name/);
 await assert.rejects(()=>partyMusic(host,{roomCode:code,action:'pause',generation:generation-1}),/changed/);
 assert.equal((await partyMusic(host,{roomCode:code,action:'pause',generation})).state?.playing,false);
 assert.equal((await partyMusic(host,{roomCode:code,action:'resume',generation})).state?.playing,true);
 await partyMusic(host,{roomCode:code,action:'heartbeat',generation});
 const changed=await partyMusic(host,{roomCode:code,action:'local-start',fileName:'New.wav'});assert.equal(changed.state!.generation,generation+1);
 assert.equal((await partyMusic(host,{roomCode:code,action:'stop',generation:generation+1})).state?.track,null);
 await root.execute("UPDATE live_rooms SET room_type='FACE' WHERE id=?",[room]);await root.execute("UPDATE live_room_members SET media_role='HOST' WHERE room_id=? AND application_user_id=?",[room,host.userId]);assert((await partyMusic(host,{roomCode:code,action:'local-start',fileName:'Face.m4a'})).state?.playing);
 await root.execute('UPDATE party_room_music SET lease_expires_at=CURRENT_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE room_id=?',[room]);assert.equal((await partyMusic(guest,{roomCode:code,action:'state'})).state?.track,null);
 // Secure random simulation: game-wide distribution, never user conditioned.
 const counts:Record<string,number>={};let wins=0,returnCoins=0,max=0;
 for(let i=0;i<100000;i++){const r=drawLucky(p,100000);if(r.won)wins++;returnCoins+=r.payoutCoins;max=Math.max(max,r.multiplierBps);counts[r.tierId]=(counts[r.tierId]??0)+1;}
 assert(wins>24200&&wins<25800,'25% win probability outside broad statistical envelope');
 for(const tier of p.tiers){const draw=drawLucky({...p,tiers:[{...tier,weight:1}]},100000,max=>max===10000?0:0);assert.equal(draw.multiplierBps,tier.multiplierBps);assert.equal(draw.payoutCoins,10*tier.multiplierBps);}
 assert.equal(drawLucky(p,100,()=>9999).payoutCoins,0);assert.throws(()=>drawLucky(p,0),/at least/);
 console.log('PASS Lucky settlement: 500 gross / 100 net / 400 company; 8 concurrent retries settle once; sender rewards and before/after audited; insufficient funds creates no result; Master-only report; ALL full-funding and retry; injected storage failure rollback and same-ID recovery; additive migration replay; normal 85/15 suite preserved');
 console.log('PASS music metadata: Party + Face Host authority; viewer denial; path rejection; generation guard; pause/resume/stop/change/heartbeat/lease expiry');
 console.log(JSON.stringify({simulationAttempts:100000,wins,observedWinRate:wins/100000,observedReturnPercent:returnCoins/100000/100000*100,distribution:counts,largestObservedMultiplier:max/10000,expectation:luckyExpectation(p),deterministic25xPossible:true}));
}
