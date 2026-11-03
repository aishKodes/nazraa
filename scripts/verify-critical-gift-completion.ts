import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import mysql from 'mysql2/promise';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
async function main(){
 const q=JSON.parse(await readFile('/tmp/nazraa-owner-staging-fixtures.json','utf8'));assert.match(q.database,/^nazraa_mobile_qa_\d+$/);
 const pool=mysql.createPool({host:'127.0.0.1',user:'root',database:q.database,timezone:'Z',charset:'utf8mb4_general_ci',multipleStatements:true,connectionLimit:6,decimalNumbers:true});global.nazraaPool=pool;global.nazraaInstrumentedPool=pool;
 const [sender,host,other]=q.fixtures;
 try{
 await pool.query(await readFile('db/migrations/0114_role_frame_selection_gift_history.sql','utf8'));
 const {sendGift,gameSharedRoundState,placeSharedGameBets,maintainSharedGameRounds}=await import('../lib/db/repositories/mobile-product');
 const {giftHistory}=await import('../lib/db/repositories/gift-history');
 async function allHistory(who:typeof host,request:Parameters<typeof giftHistory>[1],now?:Date){const records=[];let before:string|undefined;for(let page=0;page<100;page++){const result=await giftHistory(who,{...request,before},now);records.push(...result.records);if(!result.next)break;before=result.next;}return records;}

 const cosmetics=await import('../lib/db/repositories/mobile-cosmetics');
 const {grantRoleFrame}=await import('../lib/db/repositories/role-frame-selection');
 const {premiumRoleFamilies}=await import('../lib/db/repositories/premium-role-visuals');
 const {accountById,scopeFor}=await import('../lib/db/repositories/accounts');
 const [masters]=await pool.query<mysql.RowDataPacket[]>("SELECT id FROM platform_accounts WHERE role='MASTER' AND status='ACTIVE' LIMIT 1");const master=await scopeFor((await accountById(masters[0].id))!);
 await pool.execute("UPDATE application_users SET is_host=TRUE,equipped_role_frame=NULL,role_frame_grants=NULL WHERE id=?",[host.userId]);
 await grantRoleFrame(master,{publicId:host.publicId,family:'official',grant:true,reason:'Isolated completion QA decorative grant'});
 let snap=await cosmetics.cosmeticSnapshot(host);assert.equal(snap.entitlements.filter(e=>e.source==='ROLE').length,5);assert(snap.roleCatalog.some(c=>c.id==='role_v6_host_diamond_frame'));
 await cosmetics.equippedCosmeticLoadoutsByPublicId([host.publicId]); // Prime old loadout cache.
 await cosmetics.setCosmeticEquipped(host,{entitlementId:'role-frame:host_diamond',equipped:true});
 assert.equal((await cosmetics.equippedCosmeticLoadoutsByPublicId([host.publicId])).get(host.publicId)?.AVATAR_FRAME.itemId,'role_v6_host_diamond_frame');
 assert.equal((await cosmetics.cosmeticSnapshot(host)).loadout.AVATAR_FRAME.itemId,'role_v6_host_diamond_frame');
 await assert.rejects(()=>cosmetics.setCosmeticEquipped(host,{entitlementId:'role-frame:owner',equipped:true}),/not available/);
 await cosmetics.setCosmeticEquipped(host,{entitlementId:'role-frame:host_diamond',equipped:false});assert.equal((await cosmetics.cosmeticSnapshot(host)).loadout.ROLE_PRESENTATION.effectConfig.roleFrameDisabled,true);
 await grantRoleFrame(master,{publicId:host.publicId,family:'official',grant:false,reason:'Isolated completion QA revoke'});assert(!(await cosmetics.cosmeticSnapshot(host)).entitlements.some(e=>e.itemId==='role_v6_official_frame'));
 for(const family of premiumRoleFamilies){await grantRoleFrame(master,{publicId:host.publicId,family,grant:true,reason:'Isolated QA all role artwork selection'});const picked=await cosmetics.setCosmeticEquipped(host,{entitlementId:'role-frame:'+family,equipped:true});assert.equal(picked.loadout.AVATAR_FRAME.itemId,'role_v6_'+family+'_frame');}
 await cosmetics.setCosmeticEquipped(host,{entitlementId:'role-frame:host_diamond',equipped:true});
 const {luckyDefaults}=await import('../lib/policy/lucky-gifts');
 await pool.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.lucky_gifts',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",[JSON.stringify({...luckyDefaults,enabled:true}),master.account.id]);
 const room=randomUUID(),code='completion-'+room;await pool.execute("INSERT INTO live_rooms(id,room_code,host_application_user_id,room_type,seat_count) VALUES(?,?,?,'PARTY',10)",[room,code,host.userId]);
 for(const u of [host,sender])await pool.execute("INSERT INTO live_room_members(room_id,application_user_id,room_role,media_role) VALUES(?,?,?,?)",[room,u.userId,u===host?'OWNER':'AUDIENCE',u===host?'PARTY_OWNER':'PASSIVE_VIEWER']);
 const keys={NORMAL:'completion_normal_'+Date.now(),LUCKY:'completion_lucky_'+Date.now()};
 for(const kind of ['NORMAL','LUCKY'] as const)await pool.execute("INSERT INTO gift_catalog(id,gift_key,name,category,coin_price,economy_type,created_by) VALUES(?,?,?,?,100,?,?)",[randomUUID(),keys[kind],kind+' gift',kind==='LUCKY'?'Lucky':'QA',kind,master.account.id]);
 await pool.execute("UPDATE wallet_balances SET available_balance=100000 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
 const normal=await sendGift(sender,{roomCode:code,giftId:keys.NORMAL,recipientPublicId:host.publicId,quantity:1,clientGiftId:randomUUID()});assert.equal(normal.event?.diamondValue,85);
 const intent={roomCode:code,giftId:keys.LUCKY,recipientPublicId:host.publicId,quantity:5,clientGiftId:randomUUID()};const sends=await Promise.all(Array.from({length:8},()=>sendGift(sender,intent)));assert.equal(sends.filter(s=>!s.replayed).length,1);
 const event=sends[0].event!;assert.equal(event.diamondValue,100);assert.equal(event.gift.economyType,'LUCKY');
 const [audit]=await pool.query<mysql.RowDataPacket[]>('SELECT * FROM lucky_gift_results WHERE gift_event_id=?',[event.id]);assert.equal(audit.length,1);assert.equal(Number(audit[0].company_allocation),400);assert.equal(Number(audit[0].gross_coins),500);assert.equal(Number(audit[0].receiver_diamonds),100);
 // Oct 31 23:59:59.999 IST and Nov 1 midnight IST. One millisecond apart.
 await pool.execute('UPDATE live_room_gift_events SET created_at=? WHERE id=?',[new Date('2026-10-31T18:29:59.999Z'),normal.event!.id]);
 await pool.execute('UPDATE live_room_gift_events SET created_at=? WHERE id=?',[new Date('2026-10-31T18:30:00.000Z'),event.id]);
 const november=await giftHistory(host,{scope:'received',period:'monthly'},new Date('2026-11-01T00:00:00Z'));november.records=await allHistory(host,{scope:'received',period:'monthly'},new Date('2026-11-01T00:00:00Z'));
 assert(november.records.some(r=>r.id===event.id));assert(!november.records.some(r=>r.id===normal.event!.id));assert.equal(november.monthly.businessMonth,'2026-11');
 const october=await giftHistory(host,{scope:'received',period:'monthly'},new Date('2026-10-15T00:00:00Z'));october.records=await allHistory(host,{scope:'received',period:'monthly'},new Date('2026-10-15T00:00:00Z'));assert(october.records.some(r=>r.id===normal.event!.id));assert(!october.records.some(r=>r.id===event.id));
 const history={records:await allHistory(sender,{scope:'sent',period:'all'})};assert(history.records.some(r=>r.id===normal.event!.id));assert(history.records.some(r=>r.id===event.id));assert.equal(new Set(history.records.map(r=>r.id)).size,history.records.length);
 await assert.rejects(()=>giftHistory(other,{scope:'room',period:'all',roomCode:code}),/Join the room/);
 await pool.execute("UPDATE live_rooms SET status='ENDED',ended_at=UTC_TIMESTAMP(3) WHERE id=?",[room]);
 assert((await allHistory(host,{scope:'received',period:'all'})).some(r=>r.id===event.id));
 // Same production Pro command, concurrent delivery and replay: one durable wager/debit.
 await pool.execute("UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE game_name='teen_patti_pro' AND result_ends_at>UTC_TIMESTAMP(3)");
 await maintainSharedGameRounds();
 await pool.execute("UPDATE wallet_balances SET available_balance=50000 WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
 const pro=await gameSharedRoundState(sender,'teen_patti_pro');await pool.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 30 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 33 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 36 SECOND WHERE id=?',[pro.round.id]);const input={game:'teen_patti_pro',roundId:pro.round.id,requestId:randomUUID(),bets:{'0':500}};
 await Promise.all(Array.from({length:8},()=>placeSharedGameBets(sender,input)));
 const [bets]=await pool.query<mysql.RowDataPacket[]>('SELECT * FROM game_shared_bet_requests WHERE application_user_id=? AND request_id=?',[sender.userId,input.requestId]);assert.equal(bets.length,1);
 const after=await gameSharedRoundState(sender,'teen_patti_pro');assert.equal(after.walletBalance,pro.walletBalance-500);assert.equal(after.myBets['0'],500);
 await assert.rejects(()=>placeSharedGameBets(sender,{...input,bets:{'0':1000}}),/already used/);
 await pool.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 3 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?',[pro.round.id]);
 await Promise.all([maintainSharedGameRounds(),...Array.from({length:6},()=>placeSharedGameBets(sender,input))]);
 const [settled]=await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM game_shared_settlements WHERE round_id=? AND application_user_id=?',[pro.round.id,sender.userId]);assert.equal(Number(settled[0].n),1);
 
 const report={frames:'PASS selection/restart/other-client cache/unequip/role denial/grant revoke',gifts:'PASS 85/15 normal, 20/80 Lucky, eight retries one transaction',history:'PASS durable after room end, own scope, IST boundary, unique records',pro:'PASS eight concurrent same-ID deliveries one 500 Coin debit',luckyEventId:event.id};
 console.log(JSON.stringify(report));await writeFile('/Users/aishwaryam/nazraa-release-evidence/20261103-completion/sql-results.json',JSON.stringify(report,null,2));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
