import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {autoResumeDecision} from '../lib/services/live-auto-resume-policy';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
async function main(){
  const database=`nazraa_resume_qa_${Date.now()}`;
  const root=await mysql.createConnection({host:'127.0.0.1',user:'root',multipleStatements:true,timezone:'Z',decimalNumbers:true});
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${database}\``);await root.query("SET time_zone='+00:00'");
  global.nazraaPool=mysql.createPool({host:'127.0.0.1',user:'root',database,connectionLimit:12,timezone:'Z',decimalNumbers:true});
  global.nazraaInstrumentedPool=global.nazraaPool;
  const connections=await Promise.all(Array.from({length:12},()=>global.nazraaPool!.getConnection()));
  await Promise.all(connections.map(c=>c.query("SET time_zone='+00:00'")));
  for(const c of connections)c.release();
  try{
    for(const f of (await readdir('db/migrations')).filter(x=>x.endsWith('.sql')).sort())await root.query(await readFile(`db/migrations/${f}`,'utf8'));
    const {checkpointHostLive}=await import('../lib/services/live-auto-resume');
    const {withIdempotentTransaction:tx}=await import('../lib/db/transaction');
    const host=randomUUID();
    await root.execute('INSERT INTO application_users(id,external_user_id,full_name) VALUES (?,?,?)',[host,host,'Isolated Resume QA']);
    async function session(type='FACE'){
      const room=randomUUID(),id=randomUUID();
      await root.execute('INSERT INTO live_rooms(id,room_code,host_application_user_id,room_type) VALUES (?,?,?,?)',[room,room,host,type]);
      await root.execute('INSERT INTO live_session_accounting(id,room_id,host_application_user_id,room_type,started_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP(3))',[id,room,host,type]);
      return id;
    }
    async function state(id:string){const [r]=await root.query<RowDataPacket[]>('SELECT * FROM live_session_accounting WHERE id=?',[id]);return r[0];}
    async function count(){const [r]=await root.query<RowDataPacket[]>('SELECT COALESCE(SUM(successful_resumes),0) n FROM live_auto_resume_days WHERE host_application_user_id=?',[host]);return Number(r[0].n);}
    async function step(id:string,publishing:boolean,applicationInterrupted=false,source:'HEARTBEAT'|'PROVIDER'='HEARTBEAT',occurredAt?:Date){
      return tx(c=>checkpointHostLive(c,{accountingId:id,publishing,applicationInterrupted,source,occurredAt}));
    }
    async function interrupt(id:string,seconds:number,age:number){
      await root.execute(`UPDATE live_session_accounting SET media_segment_seconds=?,valid_media_seconds=?,eligible_seconds_committed=?,
        media_publishing=TRUE,last_media_evidence_at=CURRENT_TIMESTAMP(3),auto_resume_interruption_id=NULL WHERE id=?`,[seconds,seconds,seconds,id]);
      await step(id,false,true);
      await root.execute(`UPDATE live_session_interruptions SET disconnected_at=TIMESTAMPADD(SECOND,-?,CURRENT_TIMESTAMP(3)),
        grace_expires_at=TIMESTAMPADD(SECOND,180-?,CURRENT_TIMESTAMP(3)) WHERE id=(SELECT auto_resume_interruption_id FROM live_session_accounting WHERE id=?)`,[age,age,id]);
    }
    const face=await session(); await interrupt(face,900,30); await step(face,true);
    assert.equal(Number((await state(face)).media_segment_seconds),900);assert.equal(await count(),1);
    console.log('PASS Face 15m + 30s offline restores 15m; no offline credit');
    const party=await session('PARTY');await interrupt(party,1320,179);await step(party,true);
    assert.equal(Number((await state(party)).media_segment_seconds),1320);assert.equal(await count(),2);
    console.log('PASS Party 22m + 179s; quota shared with Face');
    const at=new Date('2026-10-20T00:00:00Z');
    assert.equal(autoResumeDecision({interruptedAt:at,serverNow:new Date(+at+180000),qualifying:true,successfulToday:0}),'RESUMED');
    assert.equal(autoResumeDecision({interruptedAt:at,serverNow:new Date(+at+180001),qualifying:true,successfulToday:0}),'EXPIRED');
    await interrupt(face,2700,181);await step(face,true);assert.equal(Number((await state(face)).media_segment_seconds),0);assert.equal(await count(),2);
    assert.equal(Number((await state(face)).valid_media_seconds),2700,'actual history preserved');
    console.log('PASS exact <=180s boundary; >180 resets continuous only');
    for(let n=3;n<=5;n++){
      await interrupt(face,600*n,40);
      await Promise.all(Array.from({length:8},()=>step(face,true)));
      assert.equal(await count(),n,'retry/concurrent devices consume once');
      assert.equal(Number((await state(face)).media_segment_seconds),600*n);
    }
    await interrupt(party,2200,15);await step(party,true);
    assert.equal(await count(),5);assert.equal(Number((await state(party)).media_segment_seconds),0);
    console.log('PASS successful resumes #1–#5; concurrent replay; sixth resets without count >5');
    // Internal full transport recovery has not suspended application progress.
    await root.execute(`UPDATE live_session_accounting SET media_segment_seconds=200,media_publishing=TRUE,
      last_media_evidence_at=CURRENT_TIMESTAMP(3) WHERE id=?`,[party]);
    await step(party,false,false,'PROVIDER');await step(party,true,false,'PROVIDER');
    assert.equal(await count(),5);assert.equal(Number((await state(party)).media_segment_seconds),200);
    console.log('PASS brief internal LiveKit recovery consumes no quota, even after five');
    const partyRow=await state(party),activeGrant=randomUUID();
    await root.execute(`INSERT INTO livekit_media_access_grants(id,room_id,application_user_id,media_role,publish_mode,expires_at)
      VALUES (?,?,?,'PARTY_OWNER','audio_only',CURRENT_TIMESTAMP(3)+INTERVAL 1 HOUR)`,[activeGrant,partyRow.room_id,host]);
    await tx(c=>checkpointHostLive(c,{accountingId:party,publishing:false,source:'HEARTBEAT',applicationInterrupted:true,publisherGrantId:randomUUID()}));
    assert.equal(Boolean((await state(party)).media_publishing),true);
    assert.equal((await state(party)).auto_resume_interruption_id,null);
    console.log('PASS delayed old-device/old-process grant heartbeat cannot suspend restored Host');
    const recovered=await state(party);
    await step(party,false,false,'PROVIDER',new Date(+new Date(recovered.last_media_evidence_at)-5000));
    assert.equal(Boolean((await state(party)).media_publishing),true,'stale disconnect ignored');
    // A missed checkpoint discovers a crash without a clean false message.
    await root.execute('DELETE FROM live_auto_resume_days WHERE host_application_user_id=?',[host]);
    await root.execute(`UPDATE live_session_accounting SET media_segment_seconds=900,media_publishing=TRUE,
      last_media_evidence_at=CURRENT_TIMESTAMP(3)-INTERVAL 70 SECOND WHERE id=?`,[face]);
    await step(face,true);assert.equal(Number((await state(face)).media_segment_seconds),900);assert.equal(await count(),1);
    console.log('PASS process kill / missed-heartbeat recovery; no clean disconnect required');
    // Day rollover keeps all prior audit and wallet state, fresh quota by key.
    await root.execute('UPDATE live_auto_resume_days SET business_date=DATE_SUB(business_date,INTERVAL 1 DAY) WHERE host_application_user_id=?',[host]);
    await interrupt(face,1000,40);await step(face,true);
    const [days]=await root.query<RowDataPacket[]>('SELECT successful_resumes FROM live_auto_resume_days WHERE host_application_user_id=? ORDER BY business_date',[host]);
    assert.deepEqual(days.map(d=>Number(d.successful_resumes)),[1,1]);
    const [wallets]=await root.query<RowDataPacket[]>('SELECT COUNT(*) n FROM ledger_transactions WHERE destination_id=?',[host]);
    assert.equal(Number(wallets[0].n),0,'resuming never credits a wallet');
    console.log('PASS reward-day quota rollover; history retained; no reward/financial write from resume');
    const {loadFaceLiveRules}=await import('../lib/services/live-business-policy');
    assert.equal((await loadFaceLiveRules()).hourlyRewardDiamonds,3500);
    console.log('PASS canonical hourly amount unchanged at 3500 Diamonds; entitlement/claim engine untouched');
    // Real canonical reward creation and claim, not a mock payout assertion.
    const master=randomUUID(),agency=randomUUID(),rule=randomUUID();
    for(const [id,role] of [[master,'MASTER'],[agency,'AGENCY']])await root.execute(
      'INSERT INTO platform_accounts(id,public_id,role,role_code,full_name,password_hash) VALUES (?,?,?,?,?,?)',
      [id,role==='MASTER'?100001:200001,role,id.slice(0,20),`Isolated ${role}`,'not-a-login-credential']);
    await root.execute("UPDATE application_users SET is_host=TRUE,face_verification_status='VERIFIED',agency_account_id=?,gender='MALE' WHERE id=?",[agency,host]);
    await root.execute("INSERT INTO host_profiles(id,application_user_id,agency_account_id,status,verification_status) VALUES (?,?,?,'ACTIVE','VERIFIED')",[randomUUID(),host,agency]);
    await root.execute("INSERT INTO host_reward_rules(id,room_type,coins_per_hour,minimum_eligible_seconds,effective_from,updated_by) VALUES (?,'FACE',3500,3600,CURRENT_TIMESTAMP(3),?)",[rule,master]);
    const row=await state(face);
    await root.execute('UPDATE live_rooms SET agency_account_id=? WHERE id=?',[agency,row.room_id]);
    await root.execute("INSERT INTO live_room_members(room_id,application_user_id,room_role,media_role,muted) VALUES (?,?,'OWNER','HOST',FALSE)",[row.room_id,host]);
    await root.execute(`UPDATE live_session_accounting SET media_segment_seconds=3590,eligible_duration_seconds=0,
      auto_resume_interruption_id=NULL,media_publishing=TRUE,last_media_evidence_at=CURRENT_TIMESTAMP(3)-INTERVAL 10 SECOND,reward_rule_id=? WHERE id=?`,[rule,face]);
    const {reconcileCheckpointedLiveRewards,claimLiveReward}=await import('../lib/db/repositories/mobile-completion');
    await Promise.all(Array.from({length:8},()=>tx(async c=>{
      await checkpointHostLive(c,{accountingId:face,publishing:true,source:'HEARTBEAT'});
      await reconcileCheckpointedLiveRewards(c,face);
    })));
    const [entitlements]=await root.query<RowDataPacket[]>('SELECT id,amount,claim_status FROM live_reward_entitlements WHERE application_user_id=?',[host]);
    assert.equal(entitlements.length,1);assert.equal(Number(entitlements[0].amount),3500);assert.equal(entitlements[0].claim_status,'UNCLAIMED');
    const [beforeClaim]=await root.query<RowDataPacket[]>('SELECT COUNT(*) n FROM ledger_transactions WHERE destination_id=?',[host]);assert.equal(Number(beforeClaim[0].n),0);
    await Promise.all(Array.from({length:5},()=>claimLiveReward({userId:host} as never,entitlements[0].id)));
    const [credits]=await root.query<RowDataPacket[]>("SELECT COUNT(*) n,SUM(amount) amount FROM ledger_transactions WHERE destination_id=? AND transaction_type='HOST_HOURLY_DIAMONDS'",[host]);
    assert.equal(Number(credits[0].n),1);assert.equal(Number(credits[0].amount),3500);
    console.log('PASS 60m => one UNCLAIMED 3500-Diamond reward; no auto-credit; concurrent Claim credits once');
  }finally{
    await global.nazraaPool.end();await root.query(`DROP DATABASE \`${database}\``);await root.end();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
