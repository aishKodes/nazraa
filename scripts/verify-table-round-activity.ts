/** Actual existing repository/SQL/Redis test on disposable local owner fixtures. */
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c)}});
async function main(){
 const q=JSON.parse(await readFile('/tmp/nazraa-owner-staging-fixtures.json','utf8'));assert.match(q.database,/^nazraa_mobile_qa_\d+$/);
 const pool=mysql.createPool({host:'127.0.0.1',user:'root',database:q.database,timezone:'Z',decimalNumbers:true,connectionLimit:4});pool.on('connection',c=>{void c.query("SET time_zone='+00:00'")});global.nazraaPool=pool;global.nazraaInstrumentedPool=pool;process.env.REDIS_URL='redis://127.0.0.1:56379';
 const {gameSharedRoundState,placeSharedGameBets,maintainSharedGameRounds}=await import('../lib/db/repositories/mobile-product');
 const {sharedTableActivity}=await import('../lib/db/repositories/shared-table-activity');
 const c=await pool.getConnection(),report=[];
 try {
  for(let n=0;n<3;n++) {
   await c.execute("UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE game_name='teen_patti_pro' AND result_ends_at>UTC_TIMESTAMP(3)");
   const s=await gameSharedRoundState(q.fixtures[0],'teen_patti_pro');
   await c.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 20 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 21 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 27 SECOND WHERE id=?',[s.round.id]);
   const [rows]=await c.query<mysql.RowDataPacket[]>('SELECT outcome_json FROM game_shared_rounds WHERE id=?',[s.round.id]);const outcome=typeof rows[0].outcome_json==='string'?JSON.parse(rows[0].outcome_json):rows[0].outcome_json;
   for(let i=0;i<3;i++) {
    const request={requestId:randomUUID(),game:'teen_patti_pro',roundId:s.round.id,bets:{[String(outcome.winnerLane)]:500*(i+1)}};
    const accepted=await placeSharedGameBets(q.fixtures[i],request),retry=await placeSharedGameBets(q.fixtures[i],request);
    assert.deepEqual(accepted.myBets,retry.myBets);assert.equal(accepted.walletBalance,retry.walletBalance);assert.equal(accepted.tableActivity?.participants[String(outcome.winnerLane)].length,i+1);
   }
   const open=await sharedTableActivity(c,'teen_patti_pro',s.round.id,s.round.number);assert.deepEqual(open.roundTopWinners,[]);assert.equal(open.betVersion,3);
   await c.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 6 SECOND WHERE id=?',[s.round.id]);
   await maintainSharedGameRounds();await maintainSharedGameRounds();
   const a=await sharedTableActivity(c,'teen_patti_pro',s.round.id,s.round.number);
   const [settled]=await c.query<mysql.RowDataPacket[]>('SELECT s.payout_total,u.public_id FROM game_shared_settlements s JOIN application_users u ON u.id=s.application_user_id WHERE s.round_id=? ORDER BY s.payout_total DESC,u.public_id',[s.round.id]);
   assert.equal(settled.length,3);assert.equal(a.winnerScope,'ROUND');assert.equal(a.winnersRoundId,s.round.id);assert.deepEqual(a.roundTopWinners.map(x=>({id:x.userId,amount:x.amount})),settled.map(x=>({id:String(x.public_id),amount:Number(x.payout_total)})));assert.equal(a.roundTopWinners.length,3);assert(!a.roundTopWinners.some(x=>x.userId===q.fixtures[3].publicId));
   await c.execute('UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?',[s.round.id]);
   const next=await gameSharedRoundState(q.fixtures[0],'teen_patti_pro');assert.notEqual(next.round.id,s.round.id);assert.deepEqual(next.tableActivity?.roundTopWinners,[]);assert.equal(Object.values(next.tableActivity!.targetTotals).reduce((a,b)=>a+b,0),0);
   report.push({round:s.round.id,winnerLane:outcome.winnerLane,acceptedLines:a.betVersion,winners:a.roundTopWinners,settlements:settled.length,nextCleared:true});
  }
  await c.execute("UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE game_name='teen_patti' AND result_ends_at>UTC_TIMESTAMP(3)");
  const start=await gameSharedRoundState(q.fixtures[0],'teen_patti');
  assert.equal(start.round.phase,'BETTING');
  if(start.publicPreview?.startingCardVisible===true) {assert.equal((start.publicPreview.cards as number[]).length,3);assert.equal(start.outcome,null)}
  await writeFile('/tmp/nazraa-pro-round-activity-results.json',JSON.stringify(report,null,2));console.log('PASS Pro three actual rounds / 3 users; exactly-once receipts and settlement; current-round-only podium; no carry into next round.');
 } finally {c.release();await pool.end()}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
