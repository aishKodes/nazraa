/** Rollback-only production schema/config probe. No committed QA accounts,
 * awards, notifications, balances or claims. Uses the canonical engine. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql,{type PoolConnection,type RowDataPacket} from 'mysql2/promise';
import {reconcileCheckpointedLiveRewards} from '@/lib/db/repositories/mobile-completion';
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
    await c.rollback();
    const [remaining]=await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM application_users WHERE id=?',[host]);assert.equal(Number(remaining[0].n),0);
    console.log(JSON.stringify({canonicalProductionRewardProbe:'PASS',observations,walletCredits:0,rollbackVerified:true}));
  }finally{await c.rollback();await c.end();}
}
main().catch(e=>{console.error('PRODUCTION_REWARD_PROBE_FAILED',e.code||e.name);process.exitCode=1;});
