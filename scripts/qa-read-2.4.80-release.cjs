// Read-only production verification. No credentials or individual records print.
(async()=>{
  const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,timezone:'Z'});
  try {
    const [m]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
    const [rows]=await c.query('SELECT setting_key,setting_value FROM system_settings WHERE setting_key IN (?,?)',['mobile.app_config','mobile.room_features']);
    const parsed=Object.fromEntries(rows.map(r=>[r.setting_key,typeof r.setting_value==='string'?JSON.parse(r.setting_value):r.setting_value]));
    const [segments]=await c.query('SELECT COUNT(*) total,SUM(ended_at IS NULL) active,SUM(application_user_id=board_owner_user_id) ownBoardViolations FROM party_board_seat_segments');
    const [days]=await c.query('SELECT COUNT(*) recordedDayParts,COALESCE(SUM(eligible_milliseconds),0) persistedMilliseconds FROM party_board_segment_days');
    const [users]=await c.query('SELECT id FROM application_users WHERE public_id=? AND account_status=?',[12000337,'ACTIVE']);
    let plans=[];
    if(users[0]){
      for(const sql of ['EXPLAIN SELECT business_date,SUM(eligible_milliseconds) FROM party_board_segment_days WHERE application_user_id=? GROUP BY business_date','EXPLAIN SELECT id,started_at FROM party_board_seat_segments WHERE application_user_id=? AND ended_at IS NULL']) {
        const [plan]=await c.query(sql,[users[0].id]);plans.push(...plan.map(p=>({table:p.table,type:p.type,key:p.key,rows:p.rows})));
      }
    }
    const health=await fetch('http://127.0.0.1:3000/api/internal/health');
    console.log(JSON.stringify({schema:m[0]?.name,provider:process.env.MEDIA_PROVIDER,latest:parsed['mobile.app_config']?.latestVersion,minimum:parsed['mobile.app_config']?.minimumVersion,grace:parsed['mobile.room_features']?.mediaReconnectGraceSeconds,healthStatus:health.status,segments:segments[0],dayParts:days[0],plans}));
  }finally{await c.end();}
})().catch(e=>{console.log('RELEASE_READ_FAILED',e.code||e.errno||'UNAVAILABLE');process.exitCode=1;});
