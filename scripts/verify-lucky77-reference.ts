/** Isolated financial regression. Never loads production credentials or data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { MobileIdentity } from '@/lib/auth/mobile-session';
import { defaultMobileGamesConfig } from '@/lib/games/game-config';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
} });

async function main() {
  const database = `nazraa_lucky77_qa_${Date.now()}`;
  const port = Number(process.env.NAZRAA_LOCAL_QA_DB_PORT ?? 3306);
  const root = await mysql.createConnection({host:'127.0.0.1', port, user:'root', multipleStatements:true});
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${database}\``);
  global.nazraaPool = mysql.createPool({host:'127.0.0.1',port,user:'root',database,decimalNumbers:true,connectionLimit:8,timezone:'Z'});
  global.nazraaInstrumentedPool = global.nazraaPool;
  process.env.DOCUMENT_ENCRYPTION_KEY = 'isolated-lucky77-qa-not-production';
  try {
    for (const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
      await root.query(await readFile(`db/migrations/${file}`, 'utf8'));
    }
    const accounts = await import('@/lib/db/repositories/accounts');
    await accounts.createInitialMaster({publicId:100001,fullName:'Local Lucky 77 QA',password:'Isolated-Local-QA-Only-2026!'});
    const master = (await accounts.accountByManagementId('100001'))!;
    // Only stretch the disposable fixture's clock so the test cannot race a
    // real 13-second boundary. All production odds, fees, units and caps stay
    // exactly at their canonical defaults. No settings are sent to production.
    const settings = structuredClone(defaultMobileGamesConfig);
    settings.games.luck77.bettingSeconds = 120;
    await root.execute(
      `INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES ('mobile.games',?,?)
       ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
      [JSON.stringify(settings),master.id],
    );
    const product = await import('@/lib/db/repositories/mobile-product');
    async function user(index:number):Promise<MobileIdentity> {
      const id=randomUUID();
      await root.execute(`INSERT INTO application_users(id,external_user_id,full_name,gender,country_code,face_verification_status,onboarding_completed)
        VALUES (?,?,?,'MALE','IN','VERIFIED',TRUE)`,[id,id,`Local Lucky QA ${index}`]);
      const [rows]=await root.query<RowDataPacket[]>('SELECT public_id FROM application_users WHERE id=?',[id]);
      await root.execute(`INSERT INTO wallet_balances(id,owner_type,owner_id,asset_type,available_balance) VALUES (?,'APPLICATION_USER',?,'COIN',100000)`,[randomUUID(),id]);
      return {
        userId:id,publicId:String(rows[0].public_id),externalUserId:id,fullName:`Local Lucky QA ${index}`,
        gender:'MALE',role:'NORMAL_USER',accountStatus:'ACTIVE',faceVerificationStatus:'VERIFIED',agencyAccountId:null,
        agencyFaceLiveAuthorized:false,superAdminFaceLiveAuthorized:false,hostAccessOverride:false,hostProfileStatus:null,
        liveRestricted:false,liveRestrictedUntil:null,liveRestrictionReason:null,temporaryLiveRestricted:false,
        temporaryLiveRestrictedUntil:null,temporaryLiveRestrictionReason:null,hostingSuspended:false,
        hostingSuspendedUntil:null,hostingSuspensionReason:null,
      };
    }
    const areas=['watermelon','seven','plum'] as const;
    const qaUsers=await Promise.all(Array.from({length:7},(_,i)=>user(i)));
    const config=settings.games.luck77;
    let settlements=0, winning=0, losing=0;
    const completedIds=new Set<string>();
    for(let cycle=0;cycle<30;cycle++) {
      const state=await product.gameSharedRoundState(qaUsers[0],'luck77');
      const roundId=state.round.id;
      assert.equal(completedIds.has(roundId),false);
      // Known authoritative fixture targets exercise all three fruits. This
      // mutation exists only inside the newly-created local QA database.
      const winner=areas[cycle%3], sector={watermelon:7,seven:0,plum:6}[winner];
      const outcome={winner,winningSegment:sector,multiplier:winner==='seven'?8:2,
        oddsFinalized:true,lucky77SpecialBonusEnabled:false,selectionModel:'BET_INDEPENDENT_FIXED_RTP'};
      await root.execute(`UPDATE game_shared_rounds SET outcome_json=?,
        betting_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND),
        drawing_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 121 SECOND),
        result_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 126 SECOND) WHERE id=?`,[JSON.stringify(outcome),roundId]);
      const records=[];
      for(const mask of cycle<3?[1,2,3,4,5,6,7]:[7]) {
        const identity=qaUsers[mask-1], bets:Record<string,number>={};
        for(let bit=0;bit<3;bit++)if(mask&(1<<bit))bets[areas[bit]]=100;
        const requestId=randomUUID();
        const before=await product.gameSharedRoundState(identity,'luck77');
        const placed=await product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId,bets});
        const wager=Object.values(bets).reduce((a,b)=>a+b,0);
        assert.equal(placed.walletBalance,before.walletBalance-wager);
        assert.equal(placed.outcome,null,'hidden outcome must not be public before close');
        assert.deepEqual(Object.keys(placed.myBets).filter(k=>placed.myBets[k]>0).sort(),Object.keys(bets).sort());
        const retry=await product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId,bets});
        assert.equal(retry.walletBalance,placed.walletBalance,'same immutable request does not debit twice');
        await assert.rejects(product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId,bets:{...bets,watermelon:(bets.watermelon??0)+100}}),/already used/);
        const expanded={watermelon:0,seven:0,plum:0,...bets};
        assert.equal((await product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId,bets:expanded})).walletBalance,placed.walletBalance);
        await assert.rejects(product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId:randomUUID(),bets}),/already used/);
        await assert.rejects(product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId,bets:{...bets,fake:0}}),/already used/);
        records.push({identity,bets,wager,requestId,balanceAfterBet:placed.walletBalance});
      }
      if(cycle===0) {
        const invalidBets:Record<string,number>[]=[{fake:100},{watermelon:50},{watermelon:-100},{watermelon:50_000_100}];
        for(const bets of invalidBets) {
          const identity=qaUsers[0], requestId=randomUUID();
          await assert.rejects(product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId,bets}));
          const [rows]=await root.query<RowDataPacket[]>('SELECT COUNT(*) n FROM game_shared_bet_requests WHERE request_id=?',[requestId]);
          assert.equal(Number(rows[0].n),0,'invalid command cannot leave debit receipt');
        }
      }
      await root.execute(`UPDATE game_shared_rounds SET
        betting_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 SECOND),
        drawing_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),
        result_committed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),
        result_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 SECOND) WHERE id=?`,[roundId]);
      await assert.rejects(product.placeSharedGameBets(qaUsers[0],{requestId:randomUUID(),game:'luck77',roundId,bets:{plum:100}}),/closed/);
      await product.maintainSharedGameRounds();
      for(const record of records) {
        const {identity,bets,wager,requestId,balanceAfterBet}=record;
        const raw=(bets[winner]??0)*(winner==='seven'?8:2);
        const gross=Math.min(Math.floor(raw*config.payoutScalePpm/1_000_000),Math.floor(wager*config.maximumPayoutMultiplier));
        const deduction=gross>wager?Math.floor(gross*settings.winnings_deduction_rate):0;
        const expected=gross-deduction;
        const [rows]=await root.query<RowDataPacket[]>('SELECT * FROM game_shared_settlements WHERE round_id=? AND application_user_id=?',[roundId,identity.userId]);
        assert.equal(rows.length,1,'one settlement for this exact round/player');
        assert.equal(Number(rows[0].gross_payout),gross);
        assert.equal(Number(rows[0].deduction_total),deduction);
        assert.equal(Number(rows[0].payout_total),expected);
        assert.equal(Number(rows[0].balance_after),balanceAfterBet+expected);
        const refreshed=await product.gameSharedRoundState(identity,'luck77');
        assert.equal(refreshed.round.id,roundId,'financial result belongs to the same round');
        assert.equal(refreshed.walletBalance,balanceAfterBet+expected);
        assert.equal(refreshed.outcome?.winner,winner);
        assert.equal(refreshed.outcome?.winningSegment,sector);
        assert.equal((await product.placeSharedGameBets(identity,{requestId,game:'luck77',roundId,bets})).walletBalance,refreshed.walletBalance,'reconnect retry after settlement never debits again');
        const history=await product.gameRoundHistory(identity,'luck77',20);
        assert.equal(history.rounds[0].outcome.sharedRoundId,roundId);
        settlements++; if(expected>0)winning++;else losing++;
      }
      // Repeat worker execution and reconnect reads must leave all balances,
      // settlements and ledger credits unchanged.
      const [before]=await root.query<RowDataPacket[]>(`SELECT COUNT(*) n,COALESCE(SUM(payout_total),0) total FROM game_shared_settlements WHERE round_id=?`,[roundId]);
      await product.maintainSharedGameRounds();
      const [after]=await root.query<RowDataPacket[]>(`SELECT COUNT(*) n,COALESCE(SUM(payout_total),0) total FROM game_shared_settlements WHERE round_id=?`,[roundId]);
      assert.deepEqual(after,before);
      completedIds.add(roundId);
      // Free the fixture's current clock slot while preserving all durable
      // historical records/IDs, as in the existing core-mobile soak harness.
      await root.execute('UPDATE game_shared_rounds SET round_number=? WHERE id=?',[Number(state.round.number)-100+cycle,roundId]);
    }
    const [duplicates]=await root.query<RowDataPacket[]>(`SELECT idempotency_key,COUNT(*) n FROM ledger_transactions
      WHERE transaction_type IN ('GAME_BET','GAME_WIN') GROUP BY idempotency_key HAVING COUNT(*)>1`);
    assert.equal(duplicates.length,0);
    const [history]=await root.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM game_shared_rounds WHERE game_name='luck77'`);
    assert.equal(Number(history[0].n),30);
    // Real production pacing changed from 13 to 15 seconds. Epoch/duration
    // numbers fell, so ORDER BY round_number returned obsolete history forever.
    const olderHighNumberId=randomUUID();
    await root.execute(`INSERT INTO game_shared_rounds
      (id,game_name,round_number,betting_starts_at,betting_ends_at,drawing_ends_at,result_committed_at,result_ends_at,result_version,outcome_json)
      SELECT ?,'luck77',999999999999,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY),
      DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY),
      DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY),1,outcome_json
      FROM game_shared_rounds WHERE game_name='luck77' LIMIT 1`,[olderHighNumberId]);
    const chronological=await product.gameSharedRoundState(qaUsers[0],'luck77');
    assert.equal(chronological.recentResults.some(row=>row.roundId===olderHighNumberId),false,
      'larger obsolete epoch numbers cannot displace the latest 20 real results');
    assert.equal(chronological.recentResults.length,20);
    for(let i=1;i<chronological.recentResults.length;i++) {
      assert.ok(new Date(chronological.recentResults[i-1].settledAt).getTime()>=new Date(chronological.recentResults[i].settledAt).getTime());
    }
    // Princess uses the same newly-corrected sparse-retry normalization,
    // but its distinct canonical 3x / 3% settlement remains untouched.
    const princessUser=await user(8);
    const princess=await product.gameSharedRoundState(princessUser,'teen_patti');
    await root.execute(`UPDATE game_shared_rounds SET betting_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),drawing_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 61 SECOND),result_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 66 SECOND) WHERE id=?`,[princess.round.id]);
    const princessRequest=randomUUID(), princessCommand={requestId:princessRequest,game:'teen_patti',roundId:princess.round.id,bets:{red:100}};
    const firstPrincess=await product.placeSharedGameBets(princessUser,princessCommand);
    assert.equal(firstPrincess.walletBalance,99900);
    assert.equal((await product.placeSharedGameBets(princessUser,princessCommand)).walletBalance,99900);
    assert.equal((await product.placeSharedGameBets(princessUser,{...princessCommand,bets:{red:100,green:0,blue:0}})).walletBalance,99900);
    await assert.rejects(product.placeSharedGameBets(princessUser,{...princessCommand,bets:{red:200}}),/already used/);
    console.log(JSON.stringify({status:'PASS',rounds:30,selectionCombinations:7,forcedServerTargets:areas,
      settlements,winning,losing,duplicateDebits:0,duplicateSettlements:0,missingHistory:0,
      princessSparseRetry:'PASS',oddsScaleChanged:false,productionDataTouched:false}));
  } finally {
    await global.nazraaPool?.end();
    await root.query(`DROP DATABASE \`${database}\``);
    await root.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
