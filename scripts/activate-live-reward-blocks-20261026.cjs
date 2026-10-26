// Existing API container only. Preserve historical awards/claims and every
// unrelated setting. Schema and tested API must be deployed before --apply.
(async()=>{
  const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
  const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try{
    await c.beginTransaction();
    const [schema]=await c.query('SELECT name FROM control_schema_migrations WHERE name=?',['0110_live_reward_blocks.sql']);
    assert.equal(schema.length,1);
    const [rows]=await c.query("SELECT setting_value FROM system_settings WHERE setting_key='mobile.live_rules' FOR UPDATE");
    assert.equal(rows.length,1);
    const old=typeof rows[0].setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0].setting_value;
    assert.equal(old.hourlyRewardDiamonds,3500);
    assert.notEqual(old.rewardEnabled,false);
    if(old.rewardBlockSeconds===1800){await c.rollback();console.log('HALF_HOUR_POLICY_ALREADY_ACTIVE; NO_MUTATION');return;}
    assert.ok(!old.rewardBlockSeconds||old.rewardBlockSeconds===3600);
    const [rules]=await c.query("SELECT * FROM host_reward_rules WHERE room_type IN ('FACE','LIVE') AND enabled=TRUE FOR UPDATE");
    assert.equal(new Set(rules.map(r=>r.room_type)).size,2);
    assert.ok(rules.every(r=>Number(r.coins_per_hour)===3500&&Number(r.minimum_eligible_seconds)===3600));
    const next={...old,rewardBlockSeconds:1800,rewardFrequency:'DAILY_TWO_HALF_HOUR_BLOCKS',maximumRewardsPerBusinessDay:2};
    if(!process.argv.includes('--apply')){await c.rollback();console.log('HALF_HOUR_ACTIVATION_GUARDS_PASS');return;}
    await c.execute("UPDATE system_settings SET setting_value=? WHERE setting_key='mobile.live_rules'",[JSON.stringify(next)]);
    for(const kind of ['FACE','LIVE']){
      const previous=rules.find(r=>r.room_type===kind);
      await c.execute('UPDATE host_reward_rules SET enabled=FALSE WHERE room_type=? AND enabled=TRUE',[kind]);
      await c.execute('INSERT INTO host_reward_rules(id,room_type,coins_per_hour,minimum_eligible_seconds,enabled,effective_from,updated_by) VALUES (?,?,3500,1800,TRUE,CURRENT_TIMESTAMP(3),?)',[randomUUID(),kind,previous.updated_by]);
    }
    // Existing undecided active broadcasts get the new cadence. Any session
    // with an old decision retains its original snapshot and history.
    const [adopted]=await c.execute(`UPDATE live_session_accounting a SET a.reward_period_seconds=1800
      WHERE a.status='ACTIVE' AND a.room_type IN ('FACE','LIVE') AND a.reward_period_seconds=3600
      AND NOT EXISTS (SELECT 1 FROM live_hour_reward_decisions d WHERE d.live_session_accounting_id=a.id)`);
    await c.execute(`INSERT INTO audit_logs(id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
      VALUES (?,'SYSTEM','live.half_hour_reward_activation','live','LIVE_CONFIGURATION','face-live',?,?,?)`,
      [randomUUID(),JSON.stringify({liveRules:old,ruleIds:rules.map(r=>r.id)}),JSON.stringify({liveRules:next,activeSessionsAdopted:adopted.affectedRows}),
       'Owner confirmed claimable Diamonds: two 1750-Diamond blocks at 1800 seconds, maximum 3500 per business day. No auto-credit; historical awards/claims and eligibility preserved.']);
    await c.commit();
    console.log(JSON.stringify({policy:'ACTIVE',secondsPerBlock:1800,diamondsPerBlock:1750,maximumBlocksPerDay:2,claimRequired:true,activeSessionsAdopted:adopted.affectedRows,historicalRecordsRewritten:0}));
  }catch(e){await c.rollback();throw e;}finally{await c.end();}
})().catch(e=>{console.error('HALF_HOUR_ACTIVATION_FAILED',e.code||e.name);process.exitCode=1;});
