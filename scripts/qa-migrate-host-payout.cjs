// Existing API container only. Credentials remain inside its process.
(async()=>{
 const m=require('mysql2/promise'),fs=require('node:fs'),crypto=require('node:crypto');
 const c=await m.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true});
 const name='0103_party_admins_host_payout.sql';
 const settings=async()=>{
   const [r]=await c.query("SELECT setting_key,setting_value FROM system_settings WHERE setting_key IN ('withdrawal.economy','mobile.features','mobile.live_rules','media.livekit','media.routing','mobile.app_config') ORDER BY setting_key");
   return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
 };
 try{
  const [latest]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
  if(latest[0]?.name===name){console.log('SCHEMA_0103_ALREADY_APPLIED');return}
  if(latest[0]?.name!=='0102_audio_party_pk.sql')throw new Error('SCHEMA_GUARD');
  const before=await settings();
  await c.query('SET SESSION lock_wait_timeout=5');
  await c.query(fs.readFileSync('/tmp/nazraa-0103.sql','utf8'));
  if(await settings()!==before)throw new Error('SETTINGS_CHANGED');
  await c.execute('INSERT INTO control_schema_migrations(name) VALUES(?)',[name]);
  console.log('SCHEMA_0103_PASS; payout rates, mobile cash-out, media, rewards and release config unchanged.');
 }finally{await c.end()}
})().catch(e=>{console.log('SCHEMA_0103_FAILED',e.code||e.message);process.exitCode=1});
