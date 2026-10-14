// Existing production API container only; publish after the exact artifact passes.
(async()=>{
  const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try {
    await c.beginTransaction();
    const [rows]=await c.query('SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE',['mobile.app_config']);
    const previous=typeof rows[0]?.setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0]?.setting_value;
    if(!previous||!['2.4.79','2.4.80'].includes(previous.latestVersion))throw new Error('UNEXPECTED_RELEASE_CONFIG');
    const next={...previous,latestVersion:'2.4.80',updateUrl:'https://nazralive.in/download'};
    if(JSON.stringify(previous)===JSON.stringify(next)){await c.rollback();console.log('LATEST_ALREADY_2_4_80');return;}
    await c.execute('UPDATE system_settings SET setting_value=? WHERE setting_key=?',[JSON.stringify(next),'mobile.app_config']);
    await c.execute(`INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason,user_agent)
      VALUES(?,NULL,'SYSTEM','settings.mobile_app_release_update','settings','system_setting','mobile.app_config',?,?,?,?)`,
      [require('node:crypto').randomUUID(),JSON.stringify(previous),JSON.stringify(next),'Owner-approved signed Android 2.4.80; Agency lifecycle and Party Board History; minimum/media/economy/reward rules preserved.','Nazraa release maintenance 2026-10-14']);
    await c.commit();
    console.log(JSON.stringify({latestVersion:next.latestVersion,minimumVersion:next.minimumVersion,minimumUnchanged:previous.minimumVersion===next.minimumVersion,mediaEconomyRulesChanged:false}));
  }catch(error){await c.rollback();console.log('RELEASE_POINTER_FAILED_ROLLED_BACK',error.code||'GUARD_FAILED');process.exitCode=1;}
  finally{await c.end();}
})().catch(()=>{console.log('RELEASE_POINTER_FAILED');process.exitCode=1;});
