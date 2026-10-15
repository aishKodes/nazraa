// Read-only exact-APK QA evidence. No tokens, names or secrets in output.
(async()=>{
 const assert=require('node:assert/strict');
 const {RoomServiceClient,TrackType}=require('livekit-server-sdk');
 const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try{
  const [rows]=await c.execute(`SELECT room.title,room.status,member.muted,user.public_id
   FROM live_rooms room JOIN live_room_members member ON member.room_id=room.id AND member.application_user_id=room.host_application_user_id
   JOIN application_users user ON user.id=member.application_user_id WHERE room.room_code=?`,[process.argv[2]]);
  assert.equal(rows.length,1);assert(rows[0].title.includes('QA'));
  const admin=new RoomServiceClient(process.env.LIVEKIT_URL.replace('wss:','https:'),process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
  const host=await admin.getParticipant(process.argv[2],rows[0].public_id);
  const audio=host.tracks.filter(t=>t.type===TrackType.AUDIO);
  const expected=process.argv[3]==='muted';
  console.log(JSON.stringify({observed:true,expectedMuted:expected,membershipMuted:Boolean(rows[0].muted),audioTracks:audio.length,trackMuted:audio.map(t=>t.muted),canPublish:host.permission.canPublish}));
  assert.equal(Boolean(rows[0].muted),expected);assert.equal(audio.length,1);assert.equal(audio[0].muted,expected);
  assert.equal(host.permission.canPublish,true);
  console.log(JSON.stringify({exactApk:true,expectedMuted:expected,membershipMuted:Boolean(rows[0].muted),livekitAudioMuted:audio[0].muted,sameParticipantConnected:true,microphoneCapabilityRetained:true}));
 }finally{await c.end();}
})().catch(error=>{console.log('EXACT_APK_MIC_ASSERTION_FAILED', /^[A-Z_]+$/.test(error.code||'')?error.code:'OBSERVATION_MISMATCH');process.exitCode=1});
