// API container after exact public-asset and website verification. Latest only.
(async()=>{
 const a=require('node:assert/strict'),{randomUUID}=require('node:crypto');
 const r=await fetch('https://nazralive.in/release/latest',{signal:AbortSignal.timeout(20000)}).then(x=>{a.equal(x.status,200);return x.json()});
 a.equal(r.version,'2.5.07');a.equal(r.build,7419);a.equal(r.sha256,'d6ccaed54c20d04e30aab9cd7231aff511d7414f288c1ac9e72e6e23541d5cfb');
 const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try{
  await c.beginTransaction();
  const [rows]=await c.query("SELECT setting_value FROM system_settings WHERE setting_key='mobile.app_config' FOR UPDATE");a.equal(rows.length,1);
  const old=typeof rows[0].setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0].setting_value;
  a.equal(old.minimumVersion,'2.1.0');a.equal(old.updateUrl,'https://nazralive.in/download');a.ok(['2.5.06','2.5.07'].includes(old.latestVersion));
  const next={...old,latestVersion:'2.5.07',latestBuild:7419};
  if(old.latestVersion===next.latestVersion&&old.latestBuild===next.latestBuild){await c.rollback();console.log('LATEST_ALREADY_CURRENT');return;}
  await c.execute("UPDATE system_settings SET setting_value=? WHERE setting_key='mobile.app_config'",[JSON.stringify(next)]);
  await c.execute(`INSERT INTO audit_logs(id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
   VALUES (?,'SYSTEM','settings.mobile_app_release_update','settings','system_setting','mobile.app_config',?,?,?)`,
   [randomUUID(),JSON.stringify({latestVersion:old.latestVersion,latestBuild:old.latestBuild,minimumVersion:old.minimumVersion}),JSON.stringify({latestVersion:next.latestVersion,latestBuild:next.latestBuild,minimumVersion:next.minimumVersion}),'Verified public 2.5.07 signed APK. Latest only; minimum version, media, economy and other app settings preserved.']);
  await c.commit();console.log('LATEST=2.5.07+7419; MINIMUM=2.1.0; ALL_OTHER_APP_CONFIG_PRESERVED');
 }catch(e){await c.rollback();throw e;}finally{await c.end();}
})().catch(e=>{console.error('VERSION_PUBLICATION_FAILED',e.code||e.name);process.exitCode=1;});
