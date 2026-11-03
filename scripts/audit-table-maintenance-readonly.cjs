/** Narrow, aggregate-only SQL plan/timing diagnostic; production read-only. */
const mysql=require('mysql2/promise');
(async()=>{
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,timezone:'Z'});
 try {
  const tables=['game_shared_rounds','game_shared_bets','game_shared_settlements'];const indexes={};
  for(const table of tables){const [rows]=await c.query('SHOW INDEX FROM '+table);indexes[table]=rows.map(r=>({name:r.Key_name,column:r.Column_name,sequence:r.Seq_in_index}));}
  const queries={
   settlement:`SELECT bet.round_id,bet.application_user_id FROM game_shared_bets bet INNER JOIN game_shared_rounds round ON round.id=bet.round_id LEFT JOIN game_shared_settlements settlement ON settlement.round_id=bet.round_id AND settlement.application_user_id=bet.application_user_id WHERE round.game_name=? AND round.drawing_ends_at<=UTC_TIMESTAMP(3) AND settlement.id IS NULL GROUP BY bet.round_id,bet.application_user_id ORDER BY CASE WHEN bet.application_user_id=? THEN 0 ELSE 1 END,CASE WHEN bet.application_user_id=? THEN MAX(round.drawing_ends_at) END DESC,MAX(round.drawing_ends_at) ASC,bet.round_id LIMIT 24`,
   active:'SELECT id FROM game_shared_rounds WHERE game_name=? AND betting_starts_at<=UTC_TIMESTAMP(3) AND result_ends_at>UTC_TIMESTAMP(3) ORDER BY betting_starts_at DESC LIMIT 1',
   latest:'SELECT id FROM game_shared_rounds WHERE game_name=? ORDER BY betting_starts_at DESC,round_number DESC LIMIT 1',
  };
  const timings={};for(const [name,sql] of Object.entries(queries)){
   const params=name==='settlement'?['teen_patti_pro','','']:['teen_patti_pro'];
   const [plan]=await c.query('EXPLAIN '+sql,params);const t=performance.now();const [rows]=await c.query(sql,params);
   timings[name]={milliseconds:Math.round(performance.now()-t),returnedRows:rows.length,plan:plan.map(r=>({table:r.table,type:r.type,key:r.key,rows:r.rows,extra:r.Extra}))};
  }
  console.log(JSON.stringify({readOnly:true,indexes,timings},null,2));
 }finally{await c.end();}
})().catch(e=>{console.error(e.code||e.name);process.exit(1)});
