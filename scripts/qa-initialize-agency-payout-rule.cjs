// Existing production API container only, after fresh verified backup and tested deployment.
// No wallet/request/settlement mutation. Only the owner-approved future rate configuration.
(async()=>{
  const {randomUUID,createHash}=require('node:crypto');
  const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const snapshots=async()=>{const [rows]=await c.query('SELECT withdrawal_id,rule_snapshot,agency_account_id,slab_diamonds,total_usd,host_usd,agency_usd,company_usd FROM host_payout_snapshots ORDER BY withdrawal_id');return rows;};
  const protectedSettings=async()=>{const [rows]=await c.query("SELECT setting_key,setting_value FROM system_settings WHERE setting_key IN ('mobile.features','mobile.live_rules','media.livekit','media.routing','mobile.games','mobile.app_config') ORDER BY setting_key");return hash(rows);};
  try {
    await c.beginTransaction();
    const protectedBefore=await protectedSettings(),oldSnapshots=await snapshots();
    const [rows]=await c.query("SELECT setting_value FROM system_settings WHERE setting_key='withdrawal.economy' FOR UPDATE");
    if(rows.length!==1)throw new Error('MISSING_EXISTING_RULE');
    const old=typeof rows[0].setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0].setting_value;
    if(old.diamondsPerBlock===undefined){
      if(old.slabDiamonds!==125000||old.totalUsdCents!==1462||old.hostUsdCents!==1000||old.agencyUsdCents!==111)throw new Error('RATE_CHANGED_REVIEW_REQUIRED');
      const next={...old,diamondsPerBlock:125000,totalUsdPerBlock:'14.62',hostUsdPerBlock:'10.00',agencyUsdPerBlock:'1.10'};
      await c.execute("UPDATE system_settings SET setting_value=? WHERE setting_key='withdrawal.economy'",[JSON.stringify(next)]);
      await c.execute(`INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason,user_agent) VALUES(?,NULL,'SYSTEM','HOST_PAYOUT_CANONICAL_BASELINE','HOST_PAYOUT','system_setting','withdrawal.economy',?,?,?,?)`,[randomUUID(),JSON.stringify(old),JSON.stringify(next),'Owner-approved future Host web payout: 125000 Diamonds → USD 10.00 Host + USD 1.10 Agency. Existing gross value retained; remainder Company; immutable historical snapshots unchanged.','Nazraa release 2.4.86 maintenance']);
    } else if(old.diamondsPerBlock!==125000||old.totalUsdPerBlock!=='14.62'||old.hostUsdPerBlock!=='10.00'||old.agencyUsdPerBlock!=='1.10')throw new Error('CANONICAL_RATE_ALREADY_CHANGED');
    if(await protectedSettings()!==protectedBefore)throw new Error('PROTECTED_SETTINGS_CHANGED');
    if(hash(await snapshots())!==hash(oldSnapshots))throw new Error('HISTORICAL_SNAPSHOTS_CHANGED');
    await c.commit();
    console.log(JSON.stringify({canonicalPayoutRule:'PASS',diamondsPerBlock:125000,hostUsdPerBlock:'10.00',agencyUsdPerBlock:'1.10',totalUsdPerBlock:'14.62',companyRemainderUsd:'3.52',historicalSnapshotsPreserved:oldSnapshots.length,walletsAndPayoutsNotMutated:true,protectedSettingsUnchanged:true}));
  }catch(e){await c.rollback();console.log(['MISSING_EXISTING_RULE','RATE_CHANGED_REVIEW_REQUIRED','CANONICAL_RATE_ALREADY_CHANGED','PROTECTED_SETTINGS_CHANGED','HISTORICAL_SNAPSHOTS_CHANGED'].includes(e.message)?e.message:'PAYOUT_BASELINE_FAILED_ROLLED_BACK');process.exitCode=1;}
  finally{await c.end();}
})().catch(()=>{console.log('PAYOUT_BASELINE_MAINTENANCE_FAILED');process.exitCode=1;});
