/** Rollback-only production schema/config probe. No committed QA accounts,
 * awards, notifications, balances or claims. Uses the canonical engine. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql,{type PoolConnection,type RowDataPacket} from 'mysql2/promise';
import {reconcileCheckpointedLiveRewards} from '@/lib/db/repositories/mobile-completion';
import {checkpointHostLive} from '@/lib/services/live-auto-resume';
async function main(){
  const c=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try{
    await c.beginTransaction();
    const [agencies]=await c.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE role='AGENCY' AND status='ACTIVE' AND public_id=852703 LIMIT 1");
    assert.equal(agencies.length,1);
    const [rules]=await c.query<RowDataPacket[]>("SELECT id FROM host_reward_rules WHERE room_type='FACE' AND enabled=TRUE AND minimum_eligible_seconds=1800 AND coins_per_hour=3500 ORDER BY effective_from DESC LIMIT 1");
    assert.equal(rules.length,1);
    const host=randomUUID(),room=randomUUID(),accounting=randomUUID(),agency=agencies[0].id;
    await c.execute("INSERT INTO application_users(id,external_user_id,full_name,gender,country_code,face_verification_status,onboarding_completed,is_host,agency_account_id) VALUES (?,?,'Rollback-only reward probe','FEMALE','IN','VERIFIED',TRUE,TRUE,?)",[host,host,agency]);
    await c.execute("INSERT INTO host_profiles(id,application_user_id,status,verification_status,agency_account_id) VALUES (?,?,'ACTIVE','VERIFIED',?)",[randomUUID(),host,agency]);
    await c.execute("INSERT INTO live_rooms(id,room_code,host_application_user_id,agency_account_id,room_type) VALUES (?,?,?,?,'FACE')",[room,`rollback-${room}`,host,agency]);
    await c.execute("INSERT INTO live_room_members(room_id,application_user_id,room_role,media_role) VALUES (?,?,'OWNER','HOST')",[room,host]);
    await c.execute("INSERT INTO live_session_accounting(id,room_id,host_application_user_id,room_type,started_at,reward_rule_id,reward_period_seconds) VALUES (?,?,?,'FACE',CURRENT_TIMESTAMP(3),?,1800)",[accounting,room,host,rules[0].id]);
    const observations=[];
    for(const [seconds,expected] of [[1799,0],[1800,1750],[3599,1750],[3600,3500],[3600,3500]]){
      await c.execute('UPDATE live_session_accounting SET media_segment_seconds=?,eligible_seconds_committed=?,valid_media_seconds=? WHERE id=?',[seconds,seconds,seconds,accounting]);
      await reconcileCheckpointedLiveRewards(c as PoolConnection,accounting);
      const [rows]=await c.query<RowDataPacket[]>('SELECT amount,claim_status,reward_period_seconds FROM live_reward_entitlements WHERE application_user_id=?',[host]);
      const sum=rows.reduce((s,r)=>s+Number(r.amount),0);assert.equal(sum,expected);assert.ok(rows.every(r=>r.claim_status==='UNCLAIMED'&&Number(r.reward_period_seconds)===1800));
      observations.push({seconds,claimableDiamonds:sum,count:rows.length});
    }
    const [ledger]=await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM ledger_transactions WHERE destination_id=?',[host]);assert.equal(Number(ledger[0].n),0);
    await c.execute('UPDATE live_session_accounting SET media_publishing=TRUE,application_instance_id=?,last_media_evidence_at=CURRENT_TIMESTAMP(3)-INTERVAL 10 SECOND WHERE id=?',['a'.repeat(32),accounting]);
    await checkpointHostLive(c as PoolConnection,{accountingId:accounting,publishing:true,source:'HEARTBEAT',applicationInstanceId:'b'.repeat(32)});
    const [restored]=await c.query<RowDataPacket[]>('SELECT media_segment_seconds FROM live_session_accounting WHERE id=?',[accounting]);assert.equal(Number(restored[0].media_segment_seconds),3600);
    const [quota]=await c.query<RowDataPacket[]>('SELECT successful_resumes FROM live_auto_resume_days WHERE host_application_user_id=?',[host]);assert.equal(Number(quota[0].successful_resumes),1);
    await c.execute('UPDATE live_daily_reward_awards SET business_date=DATE_SUB(business_date,INTERVAL 1 DAY) WHERE application_user_id=?',[host]);
    for(const seconds of [5400,7200]){
      await c.execute('UPDATE live_session_accounting SET media_segment_seconds=? WHERE id=?',[seconds,accounting]);
      await reconcileCheckpointedLiveRewards(c as PoolConnection,accounting);
    }
    const [days]=await c.query<RowDataPacket[]>('SELECT COUNT(*) n,SUM(amount) amount FROM live_daily_reward_awards WHERE application_user_id=? GROUP BY business_date',[host]);assert.equal(days.length,2);assert.ok(days.every(x=>Number(x.n)===2&&Number(x.amount)===3500));
    await c.rollback();
    const [remaining]=await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM application_users WHERE id=?',[host]);assert.equal(Number(remaining[0].n),0);
    console.log(JSON.stringify({canonicalProductionRewardProbe:'PASS',observations,fastApplicationResume:true,restartGapCreditedSeconds:0,sameSessionDayRollover:true,walletCredits:0,rollbackVerified:true}));
  }finally{await c.rollback();await c.end();}
}
main().catch(e=>{console.error('PRODUCTION_REWARD_PROBE_FAILED',e.code||e.name);process.exitCode=1;});
