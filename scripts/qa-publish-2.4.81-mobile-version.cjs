// Approved release pointer maintenance; only run after public APK SHA is verified.
(async () => {
  const {randomUUID}=require('node:crypto');
  const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try {
    await c.beginTransaction();
    const [rows]=await c.execute('SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE',['mobile.app_config']);
    const previous=typeof rows[0]?.setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0]?.setting_value;
    if(!previous||!['2.4.80','2.4.81'].includes(previous.latestVersion))throw new Error('UNEXPECTED_VERSION');
    const next={...previous,latestVersion:'2.4.81',updateUrl:'https://nazralive.in/download'};
    if(JSON.stringify(previous)===JSON.stringify(next)){await c.rollback();console.log('MOBILE_2_4_81_ALREADY_CURRENT');return;}
    await c.execute('UPDATE system_settings SET setting_value=? WHERE setting_key=?',[JSON.stringify(next),'mobile.app_config']);
    await c.execute(`INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason,user_agent) VALUES(?,NULL,'SYSTEM','settings.mobile_app_release_update','settings','system_setting','mobile.app_config',?,?,?,?)`,[randomUUID(),JSON.stringify(previous),JSON.stringify(next),'Owner-authorized tested 2.4.81 Party/Audio release; latest/download only. Minimum version, maintenance, media and economy preserved.','Nazraa approved release maintenance 2026-10-15']);
    await c.commit();
    console.log(JSON.stringify({latestVersion:next.latestVersion,minimumVersion:next.minimumVersion,minimumPreserved:previous.minimumVersion===next.minimumVersion,maintenancePreserved:previous.maintenance===next.maintenance,updateUrl:next.updateUrl,financialOrMediaRulesChanged:false}));
  } catch(_) {await c.rollback();console.log('MOBILE_2_4_81_UPDATE_FAILED_ROLLED_BACK');process.exitCode=1;}
  finally {await c.end();}
})().catch(()=>{console.log('MOBILE_RELEASE_UNAVAILABLE');process.exitCode=1;});
