// Run inside the existing API container only after public artifact verification.
(async()=>{
 const {randomUUID,createHash}=require('node:crypto');
 const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 const digest=async()=>{const [rows]=await c.query("SELECT setting_key,setting_value FROM system_settings WHERE setting_key IN ('withdrawal.economy','mobile.features','mobile.live_rules','media.livekit','media.routing','mobile.games') ORDER BY setting_key");return createHash('sha256').update(JSON.stringify(rows)).digest('hex');};
 try {
  const release=await fetch('https://nazralive.in/release/latest').then(r=>{if(!r.ok)throw new Error('PUBLIC_RELEASE_NOT_AVAILABLE');return r.json();});
  if(release.version!=='2.4.86'||release.sha256!=='cc1aacf14cc827cc672029017e0d76f793c1323e3d093d0ef83f00c67e237f66')throw new Error('PUBLIC_RELEASE_MISMATCH');
  await c.beginTransaction();const before=await digest();
  const [rows]=await c.query('SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE',['mobile.app_config']);
  if(rows.length!==1)throw new Error('MISSING_EXISTING_CONFIG');
  const previous=typeof rows[0].setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0].setting_value;
  if(!['2.4.85','2.4.86'].includes(previous.latestVersion))throw new Error('UNEXPECTED_LATEST_VERSION');
  const next={...previous,latestVersion:'2.4.86',updateUrl:'https://nazralive.in/download'};
  if(JSON.stringify(next)!==JSON.stringify(previous)){
   await c.execute('UPDATE system_settings SET setting_value=? WHERE setting_key=?',[JSON.stringify(next),'mobile.app_config']);
   await c.execute(`INSERT INTO audit_logs (id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason,user_agent) VALUES (?,NULL,'SYSTEM','settings.mobile_app_release_update','settings','system_setting','mobile.app_config',?,?,?,?)`,[randomUUID(),JSON.stringify(previous),JSON.stringify(next),'Owner-authorized Party controls and Agency payouts release 2.4.86; latest/download only. Minimum, maintenance, existing games, media and economy unchanged.','Nazraa approved release maintenance 2026-10-15']);
  }
  if(await digest()!==before)throw new Error('PROTECTED_SETTINGS_CHANGED');
  await c.commit();console.log(JSON.stringify({latestVersion:next.latestVersion,minimumVersion:next.minimumVersion,minimumPreserved:previous.minimumVersion===next.minimumVersion,maintenancePreserved:previous.maintenance===next.maintenance,protectedSettingsUnchanged:true,updateUrl:next.updateUrl}));
 } catch(error){await c.rollback();console.log(['PUBLIC_RELEASE_NOT_AVAILABLE','PUBLIC_RELEASE_MISMATCH','MISSING_EXISTING_CONFIG','UNEXPECTED_LATEST_VERSION','PROTECTED_SETTINGS_CHANGED'].includes(error.message)?error.message:'MOBILE_RELEASE_UPDATE_FAILED_ROLLED_BACK');process.exitCode=1;}
 finally {await c.end();}
})().catch(()=>{console.log('MOBILE_RELEASE_MAINTENANCE_FAILED');process.exitCode=1;});
