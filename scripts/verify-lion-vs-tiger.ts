/** Never loads production credentials. Uses one disposable loopback database. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {mock} from 'node:test';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import {defaultMobileGamesConfig,mobileGamesConfig} from '@/lib/games/game-config';
import {dealLionTigerOutcome,lionTigerAreas,lionTigerRules,settleLionTiger,validateLionTigerBets} from '@/lib/games/lion-vs-tiger';
import {sharedBetCommandSchema} from '@/lib/games/shared-bet-command';

registerHooks({resolve(specifier,context,next){return next(specifier==='server-only'?'next/dist/compiled/server-only/empty.js':specifier,context);}});

async function main(){
  assert.equal(lionTigerRules.bettingSeconds,15);
  const counts={tiger:0,draw:0,lion:0};
  for(let ticket=0;ticket<31;ticket++) counts[dealLionTigerOutcome(()=>ticket).winner]++;
  assert.deepEqual(counts,{tiger:15,draw:1,lion:15});
  for(const target of lionTigerAreas) assert.equal(counts[target]*lionTigerRules.multipliers[target],30);
  const invalid:Record<string,number>[]=[{fourth:1},{tiger:-1},{draw:1.5},{lion:NaN},{tiger:Number.MAX_SAFE_INTEGER+1}];
  for(const bets of invalid) assert.throws(()=>validateLionTigerBets(bets));
  assert.equal(validateLionTigerBets({tiger:50_000_001,draw:1,lion:2}).total,50_000_004);
  assert.equal(settleLionTiger({tiger:1,draw:7,lion:1},'draw').payout,210);
  const command={game:'lion_vs_tiger',requestId:randomUUID(),roundId:randomUUID(),bets:{tiger:50_000_001}};
  assert.ok(sharedBetCommandSchema.safeParse(command).success);
  assert.equal(sharedBetCommandSchema.safeParse({...command,game:'luck77',bets:{watermelon:50_000_001}}).success,false);
  const altered=mobileGamesConfig({games:{lion_vs_tiger:{bettingSeconds:99,maximumBet:20,outcomeWeights:[1,1,1],payoutScalePpm:800000}}}).games.lion_vs_tiger;
  assert.equal(altered.bettingSeconds,15);assert.equal(altered.maximumBet,Number.MAX_SAFE_INTEGER);
  assert.deepEqual(altered.outcomeWeights,[15,1,15]);assert.equal(altered.payoutScalePpm,1_000_000);

  const database=`nazraa_lion_tiger_qa_${Date.now()}`;
  const root=await mysql.createConnection({host:'127.0.0.1',user:'root',multipleStatements:true});
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${database}\``);
  global.nazraaPool=mysql.createPool({host:'127.0.0.1',user:'root',database,decimalNumbers:true,timezone:'Z',connectionLimit:8});
  global.nazraaInstrumentedPool=global.nazraaPool;
  process.env.DOCUMENT_ENCRYPTION_KEY='isolated-lion-tiger-test-only';
  let settlements=0,combinations=0;
  try{
    for(const file of (await readdir('db/migrations')).filter(x=>x.endsWith('.sql')).sort()) await root.query(await readFile(`db/migrations/${file}`,'utf8'));
    // Reapplying this additive migration is safe; old rows are not rewritten.
    await root.query(await readFile('db/migrations/0105_lion_vs_tiger_scoped_amounts.sql','utf8'));
    const accounts=await import('@/lib/db/repositories/accounts');
    await accounts.createInitialMaster({publicId:100001,fullName:'Local Lion Tiger QA',password:'Isolated-Local-QA-Only-2026!'});
    const master=(await accounts.accountByManagementId('100001'))!;
    const settings=structuredClone(defaultMobileGamesConfig);
    await root.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.games',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,[JSON.stringify(settings),master.id]);
    const product=await import('@/lib/db/repositories/mobile-product');
    async function user(n:number):Promise<MobileIdentity>{
      const id=randomUUID();
      await root.execute(`INSERT INTO application_users(id,external_user_id,full_name,gender,country_code,face_verification_status,onboarding_completed) VALUES(?,?,?,'MALE','IN','VERIFIED',TRUE)`,[id,id,`Lion Tiger QA ${n}`]);
      const [rows]=await root.query<RowDataPacket[]>('SELECT public_id FROM application_users WHERE id=?',[id]);
      await root.execute(`INSERT INTO wallet_balances(id,owner_type,owner_id,asset_type,available_balance) VALUES(?,'APPLICATION_USER',?,'COIN',10000000000)`,[randomUUID(),id]);
      return {userId:id,publicId:String(rows[0].public_id),externalUserId:id,fullName:`Lion Tiger QA ${n}`,gender:'MALE',role:'NORMAL_USER',accountStatus:'ACTIVE',faceVerificationStatus:'VERIFIED',agencyAccountId:null,agencyFaceLiveAuthorized:false,superAdminFaceLiveAuthorized:false,hostAccessOverride:false,hostProfileStatus:null,liveRestricted:false,liveRestrictedUntil:null,liveRestrictionReason:null,temporaryLiveRestricted:false,temporaryLiveRestrictedUntil:null,temporaryLiveRestrictionReason:null,hostingSuspended:false,hostingSuspendedUntil:null,hostingSuspensionReason:null};
    }
    const users=await Promise.all(Array.from({length:7},(_,i)=>user(i)));
    const clock=Math.floor(Date.now()/24000)*24000+1000;
    mock.timers.enable({apis:['Date'],now:clock});
    const ids=new Set<string>();
    for(let cycle=0;cycle<30;cycle++){
      mock.timers.setTime(clock+cycle*24000);
      const state=await product.gameSharedRoundState(users[0],'lion_vs_tiger');
      assert.equal(state.round.phase,'BETTING');assert.equal(state.outcome,null);
      const [timing]=await root.query<RowDataPacket[]>('SELECT TIMESTAMPDIFF(MICROSECOND,betting_starts_at,betting_ends_at)/1000000 seconds FROM game_shared_rounds WHERE id=?',[state.round.id]);
      assert.equal(Number(timing[0].seconds),15);assert.equal(ids.has(state.round.id),false);ids.add(state.round.id);
      const winner=lionTigerAreas[cycle%3];
      await root.execute('UPDATE game_shared_rounds SET outcome_json=?,drawing_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),result_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=?',[JSON.stringify({...dealLionTigerOutcome(()=>winner==='tiger'?0:winner==='draw'?15:16)}),state.round.id]);
      const records=[];
      for(const mask of cycle<3?[1,2,3,4,5,6,7]:[7]){
        const identity=users[mask-1],bets:Record<string,number>={};
        for(let bit=0;bit<3;bit++)if(mask&(1<<bit))bets[lionTigerAreas[bit]]=cycle===0?50_000_001:bit+1;
        const before=await product.gameSharedRoundState(identity,'lion_vs_tiger');
        const input={requestId:randomUUID(),game:'lion_vs_tiger',roundId:state.round.id,bets};
        const accepted=await product.placeSharedGameBets(identity,input), wager=Object.values(bets).reduce((a,b)=>a+b,0);
        assert.equal(accepted.walletBalance,before.walletBalance-wager);assert.equal(accepted.outcome,null);
        assert.equal((await product.placeSharedGameBets(identity,input)).walletBalance,accepted.walletBalance);
        assert.equal((await product.placeSharedGameBets(identity,{...input,bets:{tiger:0,draw:0,lion:0,...bets}})).walletBalance,accepted.walletBalance);
        await assert.rejects(product.placeSharedGameBets(identity,{...input,bets:{...bets,tiger:(bets.tiger??0)+1}}),/already used/);
        records.push({identity,input,wager,balance:accepted.walletBalance});combinations++;
      }
      await assert.rejects(product.placeSharedGameBets(users[0],{requestId:randomUUID(),game:'lion_vs_tiger',roundId:state.round.id,bets:{fourth:1}}));
      // Exact server deadline: no late tap is accepted, even before animation.
      const [ends]=await root.query<RowDataPacket[]>('SELECT betting_ends_at FROM game_shared_rounds WHERE id=?',[state.round.id]);
      mock.timers.setTime(new Date(ends[0].betting_ends_at).getTime());
      await assert.rejects(product.placeSharedGameBets(users[0],{requestId:randomUUID(),game:'lion_vs_tiger',roundId:state.round.id,bets:{tiger:1}}),/closed/);
      await root.execute(`UPDATE game_shared_rounds SET drawing_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),result_committed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?`,[state.round.id]);
      await product.maintainSharedGameRounds();
      for(const r of records){
        const expected=(r.input.bets[winner]??0)*lionTigerRules.multipliers[winner];
        const [rows]=await root.query<RowDataPacket[]>('SELECT * FROM game_shared_settlements WHERE round_id=? AND application_user_id=?',[state.round.id,r.identity.userId]);
        assert.equal(rows.length,1);assert.equal(Number(rows[0].gross_payout),expected);assert.equal(Number(rows[0].deduction_total),0);assert.equal(Number(rows[0].payout_total),expected);assert.equal(Number(rows[0].balance_after),r.balance+expected);
        assert.equal((await product.placeSharedGameBets(r.identity,r.input)).walletBalance,r.balance+expected);settlements++;
      }
      await product.maintainSharedGameRounds();
      const [count]=await root.query<RowDataPacket[]>('SELECT COUNT(*) n FROM game_shared_settlements WHERE round_id=?',[state.round.id]);assert.equal(Number(count[0].n),records.length);
    }
    mock.timers.setTime(clock+30*24000);
    const concurrentState=await product.gameSharedRoundState(users[0],'lion_vs_tiger');
    const parallel={requestId:randomUUID(),game:'lion_vs_tiger',roundId:concurrentState.round.id,bets:{tiger:73,draw:71,lion:67}};
    const responses=await Promise.all([product.placeSharedGameBets(users[0],parallel),product.placeSharedGameBets(users[0],parallel)]);
    for(const response of responses)assert.equal(response.walletBalance,concurrentState.walletBalance-211);
    const [parallelCount]=await root.query<RowDataPacket[]>('SELECT COUNT(*) n FROM game_shared_bet_requests WHERE request_id=?',[parallel.requestId]);assert.equal(Number(parallelCount[0].n),1);
    const [duplicates]=await root.query<RowDataPacket[]>('SELECT idempotency_key,COUNT(*) n FROM ledger_transactions GROUP BY idempotency_key HAVING COUNT(*)>1');assert.equal(duplicates.length,0);
    const history=(await product.gameSharedRoundState(users[0],'lion_vs_tiger')).recentResults;
    assert.equal(history.length,20);assert.equal(new Set(history.map(x=>x.roundId)).size,20);
    // Legacy financial constraints still apply, even to direct SQL.
    const resultId=randomUUID();
    await assert.rejects(root.execute(`INSERT INTO game_round_results(id,client_round_id,application_user_id,game_name,bets_json,outcome_json,wager_total,payout_total,balance_after) VALUES(?,?,?,'luck77','{}','{}',50000001,0,0)`,[resultId,randomUUID(),users[0].userId]));
    console.log(JSON.stringify({status:'PASS',rounds:30,allSelectionCombinations:7,acceptedCommands:combinations,settlements,missing:0,duplicates:0,deadlineSeconds:15,above50Million:'PASS',fees:0,history:20,legacyLimits:'PRESERVED',productionTouched:false}));
  }finally{
    mock.timers.reset();await global.nazraaPool?.end();await root.query(`DROP DATABASE \`${database}\``);await root.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
