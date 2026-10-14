// Read-only production release/QA cleanup verification. Never print credentials.
(async () => {
  const c = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const [schema] = await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
    const [qa] = await c.execute('SELECT id,status,seat_count FROM live_rooms WHERE room_code=?', ['NZAHN7RST9R634PZP']);
    const [rows] = await c.execute("SELECT setting_key,setting_value FROM system_settings WHERE setting_key IN ('mobile.app_config','mobile.features')");
    const settings = Object.fromEntries(rows.map(r => [r.setting_key,
      typeof r.setting_value === 'string' ? JSON.parse(r.setting_value) : r.setting_value]));
    const { RoomServiceClient } = require('livekit-server-sdk');
    const rooms = await new RoomServiceClient(process.env.LIVEKIT_URL.replace('wss:', 'https:'),
      process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET).listRooms();
    const [payouts] = await c.query('SELECT COUNT(*) count FROM host_payout_snapshots');
    const [audits] = await c.execute("SELECT COUNT(*) count FROM audit_logs WHERE action='settings.mobile_app_release_update' AND new_data LIKE ?", ['%2.4.82%']);
    console.log(JSON.stringify({ schema: schema[0]?.name, qaPartyStatus: qa[0]?.status,
      qaLayoutRestored: qa[0]?.seat_count === 10,
      syntheticQaRoomsRemaining: rooms.filter(r => r.name.startsWith('QA_APK_')).length,
      qaPartyLivekitRoomRemaining: rooms.some(r => r.name === qa[0]?.id || r.name.includes('NZAHN7RST9R634PZP')),
      latestVersion: settings['mobile.app_config']?.latestVersion,
      minimumVersion: settings['mobile.app_config']?.minimumVersion,
      mobileWithdrawalEnabled: settings['mobile.features']?.withdrawalEnabled === true,
      mobileCreatorCashEnabled: settings['mobile.features']?.creatorCashWithdrawalsEnabled === true,
      newWorkflowProductionPayouts: Number(payouts[0].count),
      releaseAuditRecorded: Number(audits[0].count) > 0, livekitServiceReachable: true }));
  } finally { await c.end(); }
})().catch(() => { console.log('RELEASE_READ_UNAVAILABLE'); process.exitCode = 1; });
