import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFile} from 'node:fs/promises';
import mysql,{type RowDataPacket} from 'mysql2/promise';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
async function main(){
 const q=JSON.parse(await readFile('/tmp/nazraa-gm-qa-fixtures.json','utf8'));assert.match(q.database,/^nazraa_gm_qa_\d+$/);
 const pool=mysql.createPool({host:'127.0.0.1',user:'root',database:q.database,timezone:'Z',decimalNumbers:true,connectionLimit:6});pool.on('connection',c=>{void c.query("SET time_zone='+00:00'");});global.nazraaPool=pool;global.nazraaInstrumentedPool=pool;
 try{
  const {scopeFor}=await import('@/lib/db/repositories/accounts'),{currentGameEconomy,previewGameEconomy,publishGameEconomy,gameEconomyDashboard}=await import('@/lib/db/repositories/game-economy');
  const {gameSharedRoundState}=await import('@/lib/db/repositories/mobile-product');
  const {economyModel}=await import('@/lib/games/economy-policy');const master=await scopeFor(q.master);
  const [[user]]=await pool.query<RowDataPacket[]>('SELECT u.*,a.public_id agency_public_id FROM application_users u JOIN platform_accounts a ON a.id=u.agency_account_id WHERE u.id=?',[q.people.own.id]);
  const identity={userId:String(user.id),publicId:String(user.public_id),externalUserId:String(user.external_user_id),fullName:String(user.full_name),role:'HOST' as const,accountStatus:'ACTIVE',faceVerificationStatus:'VERIFIED',agencyAccountId:String(user.agency_account_id),agencyFaceLiveAuthorized:true,superAdminFaceLiveAuthorized:true,hostAccessOverride:false,hostProfileStatus:'ACTIVE',liveRestricted:false,liveRestrictedUntil:null,liveRestrictionReason:null,temporaryLiveRestricted:false,temporaryLiveRestrictedUntil:null,temporaryLiveRestrictionReason:null,hostingSuspended:false,hostingSuspendedUntil:null,hostingSuspensionReason:null};
  const rows=[];
  for(const game of ['teen_patti','teen_patti_pro','luck77','greedy_lion','greedy_king','bounty_football'] as const){
   const {settings}=await currentGameEconomy(master),c=settings.games[game];
   const state=await gameSharedRoundState(identity,game);
   const [[before]]=await pool.query<RowDataPacket[]>('SELECT config_json,outcome_json,config_version FROM game_shared_rounds WHERE id=?',[state.round.id]);
   const draft={controlMode:'TARGET_RTP' as const,enabled:c.enabled,maintenance:c.maintenance,minimumBet:c.minimumBet,maximumBet:c.maximumBet,maximumPayoutMultiplier:c.maximumPayoutMultiplier,payoutScalePpm:c.payoutScalePpm,targetRtp:.8,denominations:c.denominations};
   const preview=await previewGameEconomy(master,game,draft);assert.equal(preview.expectedVersion,c.economyVersion??0);assert(Math.abs(preview.model.average!-.8)<.00001);
   const version=await publishGameEconomy(master,game,draft,preview.expectedVersion,'Isolated Target RTP future-round preservation test');
   const [[after]]=await pool.query<RowDataPacket[]>('SELECT config_json,outcome_json,config_version FROM game_shared_rounds WHERE id=?',[state.round.id]);assert.deepEqual(after,before,'Active round keeps exact config AND committed result');
   await assert.rejects(publishGameEconomy(master,game,draft,preview.expectedVersion,'QA stale configuration cannot publish'),/changed/);
   await pool.execute('UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?',[state.round.id]);
   const next=await gameSharedRoundState(identity,game);assert.notEqual(next.round.id,state.round.id);
   const [[stored]]=await pool.query<RowDataPacket[]>('SELECT config_version,config_json FROM game_shared_rounds WHERE id=?',[next.round.id]);assert.equal(Number(stored.config_version),version);
   const config=typeof stored.config_json==='string'?JSON.parse(stored.config_json):stored.config_json;
   assert.equal(config.targetRtp,.8);assert(Math.abs(economyModel(game,config).average!-.8)<.00001);
   const [[audit]]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM game_config_versions WHERE game_name=? AND version=? AND actor_account_id=?',[game,version,master.account.id]);assert.equal(Number(audit.n),1);
   rows.push({game,target:.8,theoretical:preview.model.average,version,activeRoundUnchanged:true,nextRoundVersion:Number(stored.config_version),auditCount:Number(audit.n)});
  }
  const dashboard=await gameEconomyDashboard(master);assert(dashboard.games.every(g=>g.windows.length===3));
  console.log(JSON.stringify({status:'PASS',rows,allGamesObservedWindows:true,productionModified:false},null,2));
 }finally{await pool.end();global.nazraaPool=undefined;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
