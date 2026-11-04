import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
async function main(){
 const q=JSON.parse(await readFile('/tmp/nazraa-owner-staging-fixtures.json','utf8'));assert.match(q.database,/^nazraa_mobile_qa_\d+$/);
 Object.assign(process.env,JSON.parse(await readFile('/tmp/nazraa-completion-local-env.json','utf8')));
 const pool=mysql.createPool({host:'127.0.0.1',user:'root',database:q.database,timezone:'Z',decimalNumbers:true,connectionLimit:8});pool.on('connection',c=>{void c.query("SET time_zone='+00:00'")});global.nazraaPool=pool;global.nazraaInstrumentedPool=pool;
 const c=await pool.getConnection();
 const decode=(v:any)=>typeof v==='string'?JSON.parse(v):v;
 const {accountById,scopeFor}=await import('../lib/db/repositories/accounts');
 const {currentGameEconomy,previewGameEconomy,publishGameEconomy,gameEconomyDashboard}=await import('../lib/db/repositories/game-economy');
 const {maintainSharedGameRounds}=await import('../lib/db/repositories/mobile-product');
 const [[m]]=await c.query<mysql.RowDataPacket[]>("SELECT id FROM platform_accounts WHERE role='MASTER' AND status='ACTIVE' LIMIT 1");assert(m);const master=await scopeFor((await accountById(m.id))!);
 const {settings}=await currentGameEconomy(master),old=settings.games.teen_patti;
 const draft={enabled:true,maintenance:false,minimumBet:100,maximumBet:50000000,maximumPayoutMultiplier:3,payoutScalePpm:1000000,princessServiceFeeBps:500,princessPayoutProfile:'PRECOMMITTED_WEIGHTED_RTP' as const,targetRtp:.8,outcomeWeights:[1,1,1],maximumSingleRoundPayout:150000000,maximumRoundExposure:1250000000,bigWinThreshold:50000,bettingSeconds:11,resultSeconds:4};
 const p=await previewGameEconomy(master,'teen_patti',draft);const v=await publishGameEconomy(master,'teen_patti',draft,p.expectedVersion,'Isolated 80% weighted fixed-return integration test');
 await assert.rejects(()=>publishGameEconomy(master,'teen_patti',draft,p.expectedVersion,'Isolated stale publication rejection'),/changed/);
 await assert.rejects(()=>previewGameEconomy({...master,account:{...master.account,role:'ADMIN'}},'teen_patti',draft),/Only Master/);
 await c.execute("UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE game_name='teen_patti' AND result_ends_at>UTC_TIMESTAMP(3)");
 const httpMetrics:number[]=[];
 async function api(i:number,path:string,body?:unknown,ok=true){const start=performance.now();const r=await fetch('http://127.0.0.1:3900/api/v1/mobile/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+q.fixtures[i].token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();httpMetrics.push(performance.now()-start);if(ok)assert(r.ok,JSON.stringify({status:r.status,message:data.message,error:data.error}));return {status:r.status,data};}
 let s:any; for(let i=0;i<45;i++){s=(await api(0,'game-state?game=teen_patti')).data;if(s.round.phase==='BETTING'&&new Date(s.round.bettingEndsAt).getTime()>Date.now()+4000)break;await new Promise(r=>setTimeout(r,500));}assert.equal(s.publicPreview.rulesVersion,'PRINCESS_PRECOMMITTED_RTP_V7');assert.equal(s.outcome,null);assert.equal(s.publicPreview.cards.length,3);assert.equal(s.publicPreview.configVersion,v);
 const roundId=s.round.id;const [[stored]]=await c.query<mysql.RowDataPacket[]>('SELECT * FROM game_shared_rounds WHERE id=?',[roundId]);assert.equal((+new Date(stored.betting_ends_at)-+new Date(stored.betting_starts_at))/1000,11);assert.equal((+new Date(stored.result_ends_at)-+new Date(stored.drawing_ends_at))/1000,4);
 const saved=JSON.stringify({config:decode(stored.config_json),outcome:decode(stored.outcome_json)});
 const balance=async(i:number)=>{const [[r]]=await c.query<mysql.RowDataPacket[]>("SELECT available_balance n FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[q.fixtures[i].userId]);return Number(r.n);};const before=await balance(0);
 const command={requestId:randomUUID(),game:'teen_patti',roundId,bets:{green:100,blue:100,red:100},quoteId:s.publicPreview.termsQuoteId};
 assert((await api(0,'game-bets',{...command,quoteId:undefined},false)).status>=400);assert.equal(await balance(0),before);
 // A little extra ONLY on this isolated test clock permits compilation and
 // bounded concurrency without confusing test-runtime delay with game timing.
 await c.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 30 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 33 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 37 SECOND WHERE id=?',[roundId]);
 const acknowledgments=await Promise.all(Array.from({length:5},()=>api(0,'game-bets',command)));assert(acknowledgments.every(r=>r.status===201));assert.equal(await balance(0),before-300);
 const more=await Promise.all(Array.from({length:10},(_,i)=>api(i%3,'game-bets',{...command,requestId:randomUUID(),bets:{green:100,blue:100,red:100}})));
 assert(more.every(r=>r.status===201));
 const [[requestCount]]=await c.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM game_shared_bet_requests WHERE round_id=?',[roundId]);assert.equal(Number(requestCount.n),11);
 const v2=await publishGameEconomy(master,'teen_patti',{...draft,targetRtp:.75,maximumSingleRoundPayout:240,maximumRoundExposure:480},v,'Isolated prospective change; existing round remains 80%');
 const [[afterCfg]]=await c.query<mysql.RowDataPacket[]>('SELECT config_json,outcome_json FROM game_shared_rounds WHERE id=?',[roundId]);assert.equal(JSON.stringify({config:decode(afterCfg.config_json),outcome:decode(afterCfg.outcome_json)}),saved);
 await c.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 4 SECOND WHERE id=?',[roundId]);
 await maintainSharedGameRounds();await maintainSharedGameRounds();
 const [settlements]=await c.query<mysql.RowDataPacket[]>('SELECT * FROM game_shared_settlements WHERE round_id=?',[roundId]);assert.equal(settlements.length,3);for(const row of settlements){assert.equal(Number(row.payout_total),Number(row.wager_total)*.8);assert.equal(Number(row.gross_payout)-Number(row.deduction_total),Number(row.payout_total));}
 const [duplicates]=await c.query<mysql.RowDataPacket[]>("SELECT idempotency_key,COUNT(*) n FROM ledger_transactions WHERE idempotency_key LIKE ? GROUP BY idempotency_key HAVING COUNT(*)>1",['SHARED_GAME:'+roundId+':%']);assert.equal(duplicates.length,0);
 const mine=settlements.find(r=>r.application_user_id===q.fixtures[0].userId)!;assert.equal(await balance(0),before-Number(mine.wager_total)+Number(mine.payout_total));
 await c.execute('UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?',[roundId]);
 const low=(await api(1,'game-state?game=teen_patti')).data;assert.equal(low.publicPreview.configVersion,v2);assert.equal(low.publicPreview.targetRtpPpm,750000);
 await c.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 15 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 18 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 22 SECOND WHERE id=?',[low.round.id]);
 const cmd={requestId:randomUUID(),game:'teen_patti',roundId:low.round.id,bets:{green:100},quoteId:low.publicPreview.termsQuoteId};
 const base=await balance(1);assert((await api(1,'game-bets',{...cmd,bets:{green:200}},false)).status>=400);assert.equal(await balance(1),base);
 await api(1,'game-bets',cmd);await api(2,'game-bets',{...cmd,requestId:randomUUID()});const base0=await balance(0);assert((await api(0,'game-bets',{...cmd,requestId:randomUUID(),bets:{green:100}},false)).status>=400);assert.equal(await balance(0),base0);
 // Current-round alert/dashboard/history derive from durable settlements.
 const dashboard=await gameEconomyDashboard(master);assert.equal(dashboard.princessWindows.length,3);assert.equal(dashboard.princessCurrent.version,v2);assert(dashboard.history.some(h=>Number(h.version)===v&&decode(h.config_json).theoreticalRtp));
 // Restore intended release config prospectively for emulator recording.
 await publishGameEconomy(master,'teen_patti',draft,v2,'Isolated restore 80% release candidate for visual verification');
 const result={status:'PASS',oldVersion:old.economyVersion,testVersion:v,nextVersion:v2,actualRoundTiming:{bettingSeconds:11,drawingSeconds:3,resultSeconds:4},publicCards:3,hiddenWinnerDuringBetting:true,retryCopies:5,durableRequests:11,concurrentRequests:10,settledPlayers:3,duplicateLedgerKeys:0,configurationFrozen:true,stalePublishRejected:true,nonMasterDenied:true,limitsRejectBeforeDebit:true,walletReconciles:true,oldClientWithoutTermsDeniedBeforeDebit:true,roundId,httpMilliseconds:httpMetrics};
 await writeFile('/Users/aishwaryam/nazraa-release-evidence/20261104-economy-pro/tests/http-ledger.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));c.release();await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
