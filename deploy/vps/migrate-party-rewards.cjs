// Run inside the EXISTING production API container only after a verified
// backup and source-baseline review. Contains no credential or reset operation.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
(async () => {
  if (process.env.NAZRAA_VERIFIED_BACKUP_REFERENCE?.length < 10 || !process.env.NAZRAA_VERIFIED_BACKUP_REFERENCE) throw Error('A verified fresh offsite backup reference is required.');
  const c = await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,timezone:'Z',multipleStatements:true});
  try {
    const [schema] = await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
    if (!['0106_pag_effect_asset_size.sql','0107_party_coin_rewards.sql','0108_party_music_state.sql'].includes(schema[0]?.name)) throw Error('Unexpected production schema; inspect and preserve baseline before continuing.');
    const [masters] = await c.query("SELECT COUNT(*) total FROM platform_accounts WHERE role='MASTER' AND status='ACTIVE'");
    if (!Number(masters[0].total)) throw Error('Active Master is required for audited default configuration.');
    const [before] = await c.query("SELECT setting_key,SHA2(setting_value,256) digest FROM system_settings WHERE setting_key IN ('mobile.live_rules','mobile.room_features','withdrawal.economy','mobile.app_config','media.provider') ORDER BY setting_key");
    await c.query('SET SESSION lock_wait_timeout=5');
    for(const name of ['0107_party_coin_rewards.sql','0108_party_music_state.sql']) {
      const [done]=await c.execute('SELECT name FROM control_schema_migrations WHERE name=?',[name]);
      if(done.length)continue;
      // Put the two reviewed SQL files alongside this helper when staging.
      await c.query(fs.readFileSync(path.join(__dirname,name),'utf8'));
      await c.execute('INSERT INTO control_schema_migrations(name) VALUES (?)',[name]);
    }
    const [after] = await c.query("SELECT setting_key,SHA2(setting_value,256) digest FROM system_settings WHERE setting_key IN ('mobile.live_rules','mobile.room_features','withdrawal.economy','mobile.app_config','media.provider') ORDER BY setting_key");
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Existing media/economy/version settings changed unexpectedly.');
    console.log('Scoped additive 0107/0108 schema verified; existing media/economy/mobile version settings unchanged.');
  } finally { await c.end(); }
})().catch(error=>{console.error('Scoped migration stopped:',error.code||error.message);process.exitCode=1;});
