// Read-only, aggregate-only audit. Run in the existing API container; never
// prints credentials, user identities, tokens, or individual wallet balances.
(async () => {
  const mysql = (await import('mysql2/promise')).default;
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    await c.query('START TRANSACTION READ ONLY');
    const query = async sql => (await c.query({ sql, timeout: 10000 }))[0];
    const daily = await query(`SELECT DATE(s.settled_at) utc_day,
      COUNT(*) settlements,COUNT(DISTINCT s.application_user_id) players,
      SUM(s.wager_total) wagers,SUM(s.gross_payout) gross,
      SUM(s.deduction_total) fee,SUM(s.payout_total) payout,
      SUM(CAST(s.wager_total AS SIGNED)-CAST(s.payout_total AS SIGNED)) platform_net
      FROM game_shared_rounds r JOIN game_shared_settlements s ON s.round_id=r.id
      WHERE r.game_name='teen_patti' AND r.betting_starts_at>=UTC_TIMESTAMP()-INTERVAL 3 DAY
      GROUP BY DATE(s.settled_at) ORDER BY utc_day`);
    const integrity = await query(`SELECT COUNT(*) settlements,
      SUM(s.deduction_total<>s.gross_payout*3/100) fee_mismatches,
      SUM(s.payout_total<>s.gross_payout-s.deduction_total) net_mismatches,
      SUM(s.gross_payout<>3*COALESCE((SELECT SUM(b.amount)
        FROM game_shared_bets b WHERE b.round_id=s.round_id
        AND b.application_user_id=s.application_user_id
        AND b.target_id=JSON_UNQUOTE(JSON_EXTRACT(r.outcome_json,'$.winner'))),0)) payout_mismatches
      FROM game_shared_rounds r JOIN game_shared_settlements s ON s.round_id=r.id
      WHERE r.game_name='teen_patti' AND r.betting_starts_at>=UTC_TIMESTAMP()-INTERVAL 3 DAY`);
    const duplicates = await query(`SELECT COUNT(*) duplicate_groups FROM
      (SELECT s.round_id,s.application_user_id FROM game_shared_rounds r
      JOIN game_shared_settlements s ON s.round_id=r.id
      WHERE r.game_name='teen_patti' AND r.betting_starts_at>=UTC_TIMESTAMP()-INTERVAL 3 DAY
      GROUP BY s.round_id,s.application_user_id HAVING COUNT(*)>1) d`);
    console.log(JSON.stringify({ readOnly: true, window: 'last 72 hours', daily, integrity, duplicates }));
    await c.rollback();
  } finally { await c.end(); }
})().catch(error => {
  console.log(JSON.stringify({ status: 'AUDIT_FAILED', code: error.code || 'DIAGNOSTIC_FAILED' }));
  process.exitCode = 1;
});
