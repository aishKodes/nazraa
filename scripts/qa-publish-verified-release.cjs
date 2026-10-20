// Run only inside the existing production API container after the exact signed
// artifact and public download have been verified. No credential is printed.
(async () => {
  const { randomUUID, createHash } = require('node:crypto');
  const [version, sha256, previousLatest] = process.argv.slice(2);
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^[a-f0-9]{64}$/.test(sha256 || '') ||
      !/^\d+\.\d+\.\d+$/.test(previousLatest || '')) throw new Error('INVALID_RELEASE_ARGUMENTS');
  const connection = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const protectedDigest = async () => {
    const [rows] = await connection.query(
      "SELECT setting_key,setting_value FROM system_settings WHERE setting_key <> 'mobile.app_config' ORDER BY setting_key",
    );
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  };
  try {
    const response = await fetch('https://nazralive.in/release/latest', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('PUBLIC_RELEASE_NOT_AVAILABLE');
    const release = await response.json();
    if (release.version !== version || release.sha256 !== sha256 ||
        !release.apkUrl?.includes(`/v${version}/`)) throw new Error('PUBLIC_RELEASE_MISMATCH');
    await connection.beginTransaction();
    const before = await protectedDigest();
    const [rows] = await connection.query(
      'SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE', ['mobile.app_config'],
    );
    if (rows.length !== 1) throw new Error('MISSING_EXISTING_CONFIG');
    const previous = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
    if (![previousLatest, version].includes(previous.latestVersion)) throw new Error('UNEXPECTED_LATEST_VERSION');
    const next = { ...previous, latestVersion: version, updateUrl: 'https://nazralive.in/download' };
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      await connection.execute('UPDATE system_settings SET setting_value=? WHERE setting_key=?',
        [JSON.stringify(next), 'mobile.app_config']);
      await connection.execute(`INSERT INTO audit_logs
        (id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason,user_agent)
        VALUES (?,NULL,'SYSTEM','settings.mobile_app_release_update','settings','system_setting','mobile.app_config',?,?,?,?)`,
        [randomUUID(), JSON.stringify(previous), JSON.stringify(next),
          `Owner-authorized signed website release ${version}; latest/download only. Minimum version, maintenance and all other settings preserved.`,
          'Nazraa owner-approved release maintenance']);
    }
    if (await protectedDigest() !== before) throw new Error('PROTECTED_SETTINGS_CHANGED');
    await connection.commit();
    console.log(JSON.stringify({ latestVersion: next.latestVersion, minimumVersion: next.minimumVersion,
      minimumPreserved: next.minimumVersion === previous.minimumVersion,
      maintenancePreserved: next.maintenance === previous.maintenance, protectedSettingsUnchanged: true,
      updateUrl: next.updateUrl }));
  } catch (error) {
    await connection.rollback();
    const known = ['PUBLIC_RELEASE_NOT_AVAILABLE', 'PUBLIC_RELEASE_MISMATCH', 'MISSING_EXISTING_CONFIG',
      'UNEXPECTED_LATEST_VERSION', 'PROTECTED_SETTINGS_CHANGED'];
    console.log(known.includes(error.message) ? error.message : 'RELEASE_UPDATE_FAILED_ROLLED_BACK');
    process.exitCode = 1;
  } finally { await connection.end(); }
})().catch(() => { console.log('RELEASE_MAINTENANCE_FAILED'); process.exitCode = 1; });
