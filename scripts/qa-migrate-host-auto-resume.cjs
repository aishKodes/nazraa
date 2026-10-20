// Existing production API container only. Additive migration; no policy writes.
(async () => {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const c = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, multipleStatements: true,
  });
  const name = '0109_host_auto_resume.sql';
  const settings = async () => {
    const [rows] = await c.query('SELECT setting_key,setting_value FROM system_settings ORDER BY setting_key');
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  };
  try {
    if (process.env.DB_NAME !== 'nazraa_final_20260929_070033') throw new Error('DATABASE_GUARD');
    const [migrations] = await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 3');
    if (migrations.some((row) => row.name === name)) {
      console.log('SCHEMA_0109_ALREADY_APPLIED');
      return;
    }
    if (migrations[0]?.name !== '0108_party_music_state.sql') throw new Error('SCHEMA_GUARD');
    const before = await settings();
    await c.query('SET SESSION lock_wait_timeout=5');
    await c.query('SET SESSION innodb_lock_wait_timeout=5');
    await c.query(fs.readFileSync('/tmp/nazraa-0109.sql', 'utf8'));
    if (await settings() !== before) throw new Error('SETTINGS_CHANGED');
    await c.execute('INSERT INTO control_schema_migrations(name) VALUES(?)', [name]);
    console.log('SCHEMA_0109_PASS; all existing settings unchanged; only additive resume tables/columns created.');
  } finally { await c.end(); }
})().catch((error) => {
  const safe = ['DATABASE_GUARD', 'SCHEMA_GUARD', 'SETTINGS_CHANGED'];
  console.log(safe.includes(error.message) ? error.message : 'SCHEMA_0109_FAILED_REQUIRES_INSPECTION');
  process.exitCode = 1;
});
