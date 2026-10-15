// Disposable production-SFU QA. Never prints credentials or participant tokens.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AccessToken,RoomServiceClient} from 'livekit-server-sdk';
import {Room,RoomEvent,AudioSource,AudioFrame,LocalAudioTrack,TrackPublishOptions,TrackSource,AudioStream,dispose} from '@livekit/rtc-node';
const url=process.env.LIVEKIT_URL;
assert.equal(url,'wss://rtc.pixtra.site');
const key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
assert(key&&secret);
const admin=new RoomServiceClient(url.replace('wss:','https:'),key,secret,{requestTimeout:2});
const name=`QA_PARTY_MIC_${randomUUID().slice(0,8)}`;
const rooms=[],readers=[],loops=[];let running=true;let energy=0,frames=0;
async function join(identity,canPublish){
 const token=new AccessToken(key,secret,{identity,ttl:'5m'});
 token.addGrant({room:name,roomJoin:true,canSubscribe:true,canPublish,canPublishData:false,canPublishSources:canPublish?[TrackSource.SOURCE_MICROPHONE]:[]});
 const room=new Room();rooms.push(room);
 if(identity==='listener')room.on(RoomEvent.TrackSubscribed,(track,_pub,participant)=>{
  if(participant.identity!=='seat')return;
  const reader=new AudioStream(track,16000,1).getReader();readers.push(reader);
  loops.push((async()=>{try{while(running){const sample=await reader.read();if(sample.done)break;frames++;for(const x of sample.value.data)energy+=Math.abs(x);}}catch{}})());
 });
 await room.connect(url,await token.toJwt(),{autoSubscribe:true});return room;
}
async function publish(room){
 const source=new AudioSource(16000,1),track=LocalAudioTrack.createAudioTrack('QA microphone',source);
 const options=new TrackPublishOptions();options.source=TrackSource.SOURCE_MICROPHONE;
 const pub=await room.localParticipant.publishTrack(track,options);
 loops.push((async()=>{let n=0;try{while(running){const data=new Int16Array(320);for(let i=0;i<320;i++)data[i]=Math.round(3000*Math.sin(2*Math.PI*440*(n+i)/16000));n+=320;await source.captureFrame(new AudioFrame(data,16000,1,320));await delay(20);}}catch{}})());
 return pub;
}
async function until(check){for(let n=0;n<40;n++){if(await check())return;await delay(150);}assert.fail('Media assertion timed out');}
async function permission(canPublish){await admin.updateParticipant(name,'seat',{permission:{canSubscribe:true,canPublish,canPublishData:false,canPublishSources:canPublish?[TrackSource.SOURCE_MICROPHONE]:[]}});await delay(300);}
try{
 await admin.createRoom({name,emptyTimeout:60,maxParticipants:4});
 const seat=await join('seat',false);await join('listener',false);
 assert.equal((await admin.getParticipant(name,'seat')).permission.canPublish,false);
 await permission(true);let pub=await publish(seat);
 await until(()=>energy>100000);const connectedTrack=pub.sid;
 // Deliberate local mute/unmute: same participant and Room, track may republish.
 await seat.localParticipant.unpublishTrack(pub.sid);await delay(500);
 assert.equal((await admin.getParticipant(name,'seat')).permission.canPublish,true);
 pub=await publish(seat);const before=energy;await until(()=>energy>before+100000);
 await permission(false);await until(async()=>!(await admin.getParticipant(name,'seat')).tracks.length);
 assert.equal((await admin.getParticipant(name,'seat')).permission.canSubscribe,true);
 await permission(true);await delay(400);
 assert.equal((await admin.getParticipant(name,'seat')).tracks.length,0,'Staff lift cannot remotely start hardware');
 pub=await publish(seat);const resumed=energy;await until(()=>energy>resumed+100000);
 await permission(false);await until(async()=>!(await admin.getParticipant(name,'seat')).tracks.length);
 await permission(true);pub=await publish(seat);const rejoined=energy;await until(()=>energy>rejoined+100000);
 assert.equal((await admin.listParticipants(name)).length,2,'No duplicate Room/participant during mic transitions');
 console.log(JSON.stringify({passiveGrantDenied:true,seatGrantPublishesActualAudio:true,selfMuteUnmuteSameRoom:true,staffMuteRevokesPublication:true,staffLiftDoesNotOpenMic:true,explicitUnmuteReceivesAudio:true,leaveReseatReceivesAudio:true,participants:2,receivedAudioFrames:frames,republishedTrackChanged:pub.sid!==connectedTrack,credentialsLogged:false}));
}finally{
 running=false;await Promise.allSettled(readers.map(r=>r.cancel()));
 await Promise.allSettled(rooms.map(r=>r.disconnect()));await Promise.allSettled(loops);
 await admin.deleteRoom(name);await dispose();console.log('PARTY_MIC_QA_ROOM_REMOVED');
}
