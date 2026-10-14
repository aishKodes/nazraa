// Private maintenance read: print public release/QA cleanup facts, not credentials.
(async()=>{
 const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try {
  const [schema]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
  const [qa]=await c.execute('SELECT status,seat_count FROM live_rooms WHERE room_code=?',['NZAHN7P0RHP1UCR4V']);
  const [rows]=await c.execute('SELECT setting_value FROM system_settings WHERE setting_key=?',['mobile.app_config']);
  const config=typeof rows[0].setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0].setting_value;
  const {RoomServiceClient}=require('livekit-server-sdk');
  const rooms=await new RoomServiceClient(process.env.LIVEKIT_URL.replace('wss:','https:'),process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET).listRooms();
  console.log(JSON.stringify({schema:schema[0]?.name,qaPartyStatus:qa[0]?.status,qaLayoutRestored:qa[0]?.seat_count===10,syntheticQaRoomsRemaining:rooms.filter(r=>r.name.startsWith('QA_APK_')).length,latestVersion:config.latestVersion,minimumVersion:config.minimumVersion,maintenance:config.maintenance}));
 } finally {await c.end();}
})().catch(()=>{console.log('RELEASE_READ_UNAVAILABLE');process.exitCode=1;});
