/** Real Pro SQL admission + legacy recovery in the existing disposable QA DB. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
registerHooks({resolve(s,c,n){return n(s === "server-only" ? "next/dist/compiled/server-only/empty.js" : s,c);}});
async function main() {
  const fixture = JSON.parse(await readFile("/tmp/nazraa-owner-staging-fixtures.json", "utf8"));
  assert.match(fixture.database,/^nazraa_mobile_qa_\d+$/);
  const pool = mysql.createPool({host:"127.0.0.1",user:"root",database:fixture.database,timezone:"Z",decimalNumbers:true,connectionLimit:5});
  pool.on("connection", c => {void c.query("SET time_zone='+00:00'");});
  global.nazraaPool = pool; global.nazraaInstrumentedPool = pool;
  process.env.REDIS_URL = "redis://127.0.0.1:56379";
  const {gameSharedRoundState,placeSharedGameBets,maintainSharedGameRounds} = await import("../lib/db/repositories/mobile-product");
  const c = await pool.getConnection();
  const user = fixture.fixtures[0];
  async function freshRound() {
    await c.execute("UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE game_name='teen_patti_pro' AND result_ends_at>UTC_TIMESTAMP(3)");
    const state = await gameSharedRoundState(user,"teen_patti_pro");
    await c.execute("UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 30 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 31 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 35 SECOND WHERE id=?",[state.round.id]);
    return state;
  }
  async function wallet() {
    const [r] = await c.query<mysql.RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='COIN'",[user.userId]);
    return Number(r[0].available_balance);
  }
  async function mature(id:string) {
    await c.execute("UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 4 SECOND WHERE id=?",[id]);
    const result = await maintainSharedGameRounds();
    assert.deepEqual(result.failures,[]);assert(result.realtime.some(s=>s.game==='teen_patti_pro'));
  }
  try {
    const sequential = await freshRound();
    const req = (roundId:string, side:string) => ({requestId:randomUUID(),game:"teen_patti_pro",roundId,bets:{[side]:1000}});
    await placeSharedGameBets(user,req(sequential.round.id,"0"));
    await placeSharedGameBets(user,req(sequential.round.id,"1"));
    const beforeReject = await wallet();
    await assert.rejects(placeSharedGameBets(user,req(sequential.round.id,"2")),/up to 2 hands/);
    assert.equal(await wallet(),beforeReject);
    await placeSharedGameBets(user,req(sequential.round.id,"crown"));
    await mature(sequential.round.id);

    const concurrent = await freshRound();
    const beforeRace = await wallet();
    const race = await Promise.allSettled(["0","1","2"].map(side=>placeSharedGameBets(user,req(concurrent.round.id,side))));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,2);
    assert.equal(race.filter(r=>r.status==='rejected').length,1);
    assert.equal(await wallet(),beforeRace-2000);
    const [raceRows] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(DISTINCT target_id) hands,SUM(amount) amount FROM game_shared_bets WHERE round_id=? AND application_user_id=?",[concurrent.round.id,user.userId]);
    assert.equal(Number(raceRows[0].hands),2);assert.equal(Number(raceRows[0].amount),2000);
    await mature(concurrent.round.id);

    const legacy = await freshRound();
    await placeSharedGameBets(user,req(legacy.round.id,"0"));
    await placeSharedGameBets(user,req(legacy.round.id,"1"));
    // Reproduce the old accepted-third-hand ledger exactly, only in this QA database.
    const requestId=randomUUID(),requestRowId=randomUUID(),ledgerId=randomUUID();
    await c.beginTransaction();
    try {
      await c.execute("UPDATE wallet_balances SET available_balance=available_balance-1000 WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='COIN'",[user.userId]);
      await c.execute("INSERT INTO ledger_transactions (id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,source_id,destination_type,amount,status,reason,metadata) VALUES (?,?,?,'COIN','GAME_BET','APPLICATION_USER',?,'GAME',1000,'COMPLETED','QA legacy accepted third hand',?)",[ledgerId,'QALEG'+Date.now(),`SHARED_BET:${user.userId}:${requestId}`,user.userId,JSON.stringify({game:'teen_patti_pro',sharedRoundId:legacy.round.id,requestId,bets:{'2':1000}})]);
      await c.execute("INSERT INTO game_shared_bet_requests (id,request_id,round_id,application_user_id,bets_json,wager_total,ledger_transaction_id,game_name) VALUES (?,?,?,?,?,1000,?,'teen_patti_pro')",[requestRowId,requestId,legacy.round.id,user.userId,JSON.stringify({'0':0,'1':0,'2':1000,crown:0}),ledgerId]);
      await c.execute("INSERT INTO game_shared_bets (id,request_id,round_id,application_user_id,target_id,amount,game_name) VALUES (?,?,?,?,'2',1000,'teen_patti_pro')",[randomUUID(),requestRowId,legacy.round.id,user.userId]);
      await c.commit();
    } catch(e) {await c.rollback();throw e;}
    const beforeSettlement = await wallet();
    await mature(legacy.round.id);
    const [settled] = await c.query<mysql.RowDataPacket[]>("SELECT wager_total,gross_payout,payout_total FROM game_shared_settlements WHERE round_id=? AND application_user_id=?",[legacy.round.id,user.userId]);
    assert.equal(settled.length,1);assert.equal(Number(settled[0].wager_total),3000);assert(Number(settled[0].gross_payout)>0);
    assert.equal(await wallet(),beforeSettlement+Number(settled[0].payout_total));
    const once = await wallet();
    await maintainSharedGameRounds();await maintainSharedGameRounds();assert.equal(await wallet(),once);
    const [credits] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM ledger_transactions WHERE idempotency_key=?",[`SHARED_GAME:${legacy.round.id}:${user.userId}:CREDIT`]);
    assert.equal(Number(credits[0].n),1);
    await writeFile('/tmp/nazraa-pro-cumulative-recovery.json',JSON.stringify({sequentialThirdHandRejected:true,rejectedDebit:0,crownIndependent:true,concurrentAccepted:2,concurrentRejected:1,legacyWager:3000,legacySettlements:settled.length,legacyCreditCount:Number(credits[0].n),phaseRecovered:true},null,2));
    console.log("PASS sequential and concurrent cumulative two-hand admission; no rejected debit; Crown preserved; legacy accepted three-hand wager settled exactly once at original round rules.");
  } finally {c.release();await pool.end();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
