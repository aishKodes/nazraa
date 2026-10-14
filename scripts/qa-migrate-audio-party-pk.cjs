// Run inside current API container; all credentials remain in its environment.
(async()=>{
const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true,timezone:'Z'});
try{
const [schema]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
if(schema[0]?.name==='0102_audio_party_pk.sql'){console.log('SCHEMA_0102_ALREADY_CURRENT');return;}
if(schema[0]?.name!=='0101_party_board_seat_history.sql')throw new Error('UNEXPECTED_SCHEMA');
const [before]=await c.query("SELECT setting_key,SHA2(setting_value,256) digest FROM system_settings WHERE setting_key IN ('mobile.live_rules','mobile.room_features','withdrawal.economy','mobile.app_config','media.provider') ORDER BY setting_key");
await c.query('SET SESSION lock_wait_timeout=5');
await c.query(require('node:fs').readFileSync('/tmp/nazraa-0102-audio-pk.sql','utf8'));
await c.execute('INSERT INTO control_schema_migrations(name) VALUES(?)',['0102_audio_party_pk.sql']);
const [after]=await c.query("SELECT setting_key,SHA2(setting_value,256) digest FROM system_settings WHERE setting_key IN ('mobile.live_rules','mobile.room_features','withdrawal.economy','mobile.app_config','media.provider') ORDER BY setting_key");
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('UNEXPECTED_RULE_CHANGE');
console.log('SCHEMA_0102_PASS; additive Audio PK only; Face/economy/history rules unchanged');
}finally{await c.end();}
})().catch(e=>{console.log('AUDIO_PK_MIGRATION_FAILED',e.code||e.errno||'UNAVAILABLE');process.exitCode=1;});
