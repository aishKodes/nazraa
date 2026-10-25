// Run inside the existing API container only after public asset/website verification.
(async () => {
  const assert = require('node:assert/strict');
  const {randomUUID} = require('node:crypto');
  const release = await fetch('https://nazralive.in/release/latest', {signal: AbortSignal.timeout(20000)}).then(r => {assert.equal(r.status,200); return r.json();});
  assert.equal(release.version, '2.5.06'); assert.equal(release.build, 7418);
  assert.equal(release.sha256, '210f876cb28313266aa314c190adff3eb566881f1f2cc9c3c55f4b5c2b9510bf');
  const c = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    await c.beginTransaction();
    const [rows] = await c.query('SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE',['mobile.app_config']);
    assert.equal(rows.length,1);
    const old = typeof rows[0].setting_value==='string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
    assert.equal(old.minimumVersion,'2.1.0','Do not force an unverified real-user upgrade');
    assert.equal(old.updateUrl,'https://nazralive.in/download');
    assert.ok(['2.5.02','2.5.06'].includes(old.latestVersion),'Unexpected release pointer; stop');
    if(old.latestVersion==='2.5.06') { await c.rollback(); console.log('LATEST_ALREADY_CURRENT; NO_MUTATION'); return; }
    await c.execute("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.latestVersion',?) WHERE setting_key=?",['2.5.06','mobile.app_config']);
    const next={...old, latestVersion:'2.5.06'};
    await c.execute(`INSERT INTO audit_logs (id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
      VALUES (?,'SYSTEM','settings.mobile_app_release_update','settings','system_setting','mobile.app_config',?,?,?)`,
      [randomUUID(),JSON.stringify({latestVersion:old.latestVersion,minimumVersion:old.minimumVersion}),
        JSON.stringify({latestVersion:next.latestVersion,minimumVersion:next.minimumVersion}),
        'Owner-authorized verified public 2.5.06 APK; latest only. Minimum, maintenance, media and economy preserved.']);
    const [saved]=await c.query('SELECT setting_value FROM system_settings WHERE setting_key=?',['mobile.app_config']);
    assert.deepEqual(typeof saved[0].setting_value==='string'?JSON.parse(saved[0].setting_value):saved[0].setting_value,next);
    await c.commit();
    console.log('LATEST_VERSION=2.5.06; MINIMUM_VERSION=2.1.0; ALL_OTHER_CONFIG_UNCHANGED');
  } catch(error) { await c.rollback(); throw error; }
  finally { await c.end(); }
})().catch(() => {console.error('VERSION_UPDATE_FAILED; NOT_COMMITTED');process.exitCode=1;});
