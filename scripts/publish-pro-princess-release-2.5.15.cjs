/** Owner-authorized release maintenance, inside the existing API container.
 * Updates only public latest-version/download metadata, with a SYSTEM audit.
 * No Master impersonation; minimum version/maintenance/media/economy preserved.
 */
(async () => {
  const { randomUUID } = require('node:crypto');
  const c = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    await c.beginTransaction();
    const [rows] = await c.query('SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE', ['mobile.app_config']);
    if (rows.length !== 1) throw new Error('EXPECTED_EXISTING_MOBILE_CONFIG_REQUIRED');
    const previous = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
    // Guard the existing release pointer; never change minimum/version policy.
    if (!['2.5.14', '2.5.15'].includes(previous.latestVersion)) throw new Error('UNEXPECTED_LATEST_VERSION_NO_CHANGE');
    const next = { ...previous, latestVersion: '2.5.15', latestBuild: 7427, updateUrl: 'https://nazralive.in/download' };
    if (JSON.stringify(next) === JSON.stringify(previous)) {
      await c.rollback();
      console.log('MOBILE_RELEASE_ALREADY_CURRENT_NO_MUTATION');
      return;
    }
    // The existing schema requires a platform-account updater FK. Retain it
    // for compatibility; the explicit SYSTEM audit records the real origin
    // instead of pretending that an authenticated Master UI session exists.
    await c.execute('UPDATE system_settings SET setting_value=? WHERE setting_key=?', [JSON.stringify(next), 'mobile.app_config']);
    await c.execute(`INSERT INTO audit_logs
      (id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason,user_agent)
      VALUES (?,NULL,'SYSTEM','settings.mobile_app_release_update','settings','system_setting','mobile.app_config',?,?,?,?)`,
      [randomUUID(), JSON.stringify(previous), JSON.stringify(next),
        'Owner-authorized Android 2.5.15 release maintenance; latest version/build/download only, minimum/maintenance/economy/media unchanged.',
        'Nazraa approved release maintenance 2026-11-03']);
    await c.commit();
    console.log(JSON.stringify({ latestVersion: next.latestVersion, latestBuild: next.latestBuild, minimumVersion: next.minimumVersion,
      minimumPreserved: previous.minimumVersion === next.minimumVersion,
      maintenancePreserved: previous.maintenance === next.maintenance, auditActor: 'SYSTEM',
      updateUrl: next.updateUrl, financialOrMediaRulesChanged: false }));
  } catch (error) {
    await c.rollback();
    console.log(['EXPECTED_EXISTING_MOBILE_CONFIG_REQUIRED','UNEXPECTED_LATEST_VERSION_NO_CHANGE'].includes(error.message)
      ? error.message : 'MOBILE_VERSION_UPDATE_FAILED_ROLLED_BACK');
    process.exitCode = 1;
  } finally { await c.end(); }
})().catch(() => { console.log('MOBILE_VERSION_MAINTENANCE_FAILED'); process.exitCode = 1; });
