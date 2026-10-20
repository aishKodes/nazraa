// Read-only, redacted production verification. Never print credentials or hands.
const mysql=require('mysql2/promise');
(async()=>{
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try{
  const [s]=await c.query("SELECT setting_value FROM system_settings WHERE setting_key='mobile.live_rules'");
  const rules=typeof s[0]?.setting_value==='string'?JSON.parse(s[0].setting_value):s[0]?.setting_value;
  console.log('LIVE_RULES_PRESERVED',JSON.stringify({hourlyRewardDiamonds:rules?.hourlyRewardDiamonds,timezone:rules?.timezone}));
  const [r]=await c.query("SELECT outcome_json FROM game_shared_rounds WHERE game_name='teen_patti' ORDER BY betting_starts_at DESC LIMIT 1");
  const o=typeof r[0]?.outcome_json==='string'?JSON.parse(r[0].outcome_json):r[0]?.outcome_json;
  console.log('LATEST_PRINCESS_PAYTABLE',JSON.stringify({rulesVersion:o?.rulesVersion,multipliers:o?.pricing?.grossMultiplierPpm,feeBps:o?.pricing?.feeBps}));
  const [m]=await c.query('SELECT COUNT(*) n FROM control_schema_migrations');console.log('MIGRATIONS_UNCHANGED',m[0].n);
  const [qa]=await c.query(`SELECT r.status,c.close_reason,c.trigger_source,c.caller_stack,c.publishing,c.created_at
    FROM live_rooms r LEFT JOIN room_close_attempts c ON c.room_id=r.id
    WHERE r.title='QA-RC251-252' ORDER BY c.created_at DESC LIMIT 3`);
  console.log('CONTROLLED_QA_ROOM_ONLY',JSON.stringify(qa));
 }finally{await c.end();}
})().catch(e=>{console.error('READ_ONLY_CHECK_FAILED',e.code||e.name);process.exitCode=1;});
