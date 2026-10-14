// Existing API container only. No environment value or private record is logged.
(async()=>{
  const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true,timezone:'Z',charset:'utf8mb4_general_ci'});
  try {
    const [schema]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
    if(schema[0]?.name==='0101_party_board_seat_history.sql'){console.log('SCHEMA_0101_ALREADY_CURRENT');return;}
    if(schema[0]?.name!=='0100_audio_room_profile_and_config.sql')throw new Error('UNEXPECTED_SCHEMA');
    const [before]=await c.query("SELECT setting_key,SHA2(setting_value,256) digest FROM system_settings WHERE setting_key IN ('mobile.live_rules','mobile.room_features','withdrawal.economy','mobile.app_config','media.provider') ORDER BY setting_key");
    await c.query('SET SESSION lock_wait_timeout=5');
    await c.query(require('node:fs').readFileSync('/tmp/nazraa-0101-party-board.sql','utf8'));
    await c.execute('INSERT INTO control_schema_migrations(name) VALUES(?)',['0101_party_board_seat_history.sql']);
    const [after]=await c.query("SELECT setting_key,SHA2(setting_value,256) digest FROM system_settings WHERE setting_key IN ('mobile.live_rules','mobile.room_features','withdrawal.economy','mobile.app_config','media.provider') ORDER BY setting_key");
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('UNEXPECTED_RULE_CHANGE');
    const [adopted]=await c.query('SELECT COUNT(*) total FROM party_board_seat_segments');
    console.log(JSON.stringify({schema:'0101',adoptedCurrentSeats:Number(adopted[0].total),pastTimeInvented:false,economyMediaRulesUnchanged:true}));
  }finally{await c.end();}
})().catch(error=>{console.log('SCOPED_MIGRATION_FAILED',error.code||'GUARD_FAILED');process.exitCode=1;});
