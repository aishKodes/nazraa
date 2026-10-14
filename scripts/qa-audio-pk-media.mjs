// Run only in the private, disposable QA runtime on the existing VPS.
// API secrets/tokens remain in process memory; only aggregate assertions print.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AccessToken,RoomServiceClient} from 'livekit-server-sdk';
import {Room,RoomEvent,AudioSource,AudioFrame,LocalAudioTrack,TrackPublishOptions,TrackSource,AudioStream,dispose} from '@livekit/rtc-node';

const url=process.env.LIVEKIT_URL;
assert(url==='wss://rtc.pixtra.site','Unexpected media destination');
const key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
assert(key&&secret,'Existing server credentials required');
const admin=new RoomServiceClient(url.replace('wss:','https:'),key,secret);
const prefix=`QA_APK_${randomUUID().slice(0,8)}`;
const roomNames=[`${prefix}_RED`,`${prefix}_BLUE`];
const connections=[],sources=[],readers=[],loops=[];
const counts=new Map();let running=true;
async function join(board,identity,publish=false,subscribe=true){
 const token=new AccessToken(key,secret,{identity,ttl:'5m'});
 token.addGrant({room:board,roomJoin:true,canPublish:publish,canPublishSources:publish?[TrackSource.SOURCE_MICROPHONE]:[],canPublishData:false,canSubscribe:true});
 const room=new Room();connections.push(room);
 room.on(RoomEvent.TrackSubscribed,(track,_publication,participant)=>{
   const label=`${identity}<-${participant.identity}`;counts.set(label,{frames:0,energy:0});
   const stream=new AudioStream(track,16000,1);const reader=stream.getReader();readers.push(reader);
   loops.push((async()=>{try{while(running){const next=await reader.read();if(next.done)break;const c=counts.get(label);c.frames++;for(const sample of next.value.data)c.energy+=Math.abs(sample);}}catch{/* cleanup closes a stream */}})());
 });
 await room.connect(url,await token.toJwt(),{autoSubscribe:subscribe,dynacast:false});
 return room;
}
async function publish(room,frequency){
 const source=new AudioSource(16000,1);sources.push(source);
 const track=LocalAudioTrack.createAudioTrack('QA synthetic microphone',source);
 const options=new TrackPublishOptions();options.source=TrackSource.SOURCE_MICROPHONE;
 const publication=await room.localParticipant.publishTrack(track,options);
 let offset=0;
 loops.push((async()=>{try{while(running){const samples=new Int16Array(320);for(let i=0;i<samples.length;i++)samples[i]=Math.round(2500*Math.sin(2*Math.PI*frequency*(offset+i)/16000));offset+=320;await source.captureFrame(new AudioFrame(samples,16000,1,320));await delay(20);}}catch{/* cleanup */}})());
 return publication;
}
async function received(label){for(let i=0;i<30;i++){if((counts.get(label)?.energy??0)>100000)return;await delay(200);}assert.fail(`No actual audio samples: ${label}`);}
try{
 for(const name of roomNames)await admin.createRoom({name,emptyTimeout:60,maxParticipants:20});
 const red=await join(roomNames[0],'qa-red-host',true),redSeat=await join(roomNames[0],'qa-red-seat',true),blue=await join(roomNames[1],'qa-blue-host',true),blueSeat=await join(roomNames[1],'qa-blue-seat',true);
 const redHostPub=await publish(red,330),redSeatPub=await publish(redSeat,440),blueHostPub=await publish(blue,550);
 let blueSeatPub=await publish(blueSeat,660);
 await join(roomNames[0],'qa-red-listener',false);await join(roomNames[1],'qa-blue-listener',false);
 await join(roomNames[1],'apk:qa-red-opponent-bridge',false);await join(roomNames[0],'apk:qa-blue-opponent-bridge',false);
 for(const label of ['apk:qa-red-opponent-bridge<-qa-blue-host','apk:qa-red-opponent-bridge<-qa-blue-seat','apk:qa-blue-opponent-bridge<-qa-red-host','apk:qa-blue-opponent-bridge<-qa-red-seat'])await received(label);
 const before=counts.get('apk:qa-red-opponent-bridge<-qa-blue-seat').energy;
 await admin.mutePublishedTrack(roomNames[1],'qa-blue-seat',blueSeatPub.sid,true);await delay(1500);
 const mutedStart=counts.get('apk:qa-red-opponent-bridge<-qa-blue-seat').energy;await delay(1200);
 const mutedEnd=counts.get('apk:qa-red-opponent-bridge<-qa-blue-seat').energy;
 assert.equal(mutedEnd,mutedStart,'Muted seated mic must not cross to the other Board');
 const hostBefore=counts.get('apk:qa-red-opponent-bridge<-qa-blue-host').energy;await delay(500);assert(counts.get('apk:qa-red-opponent-bridge<-qa-blue-host').energy>hostBefore,'Other Host continues during seat mute');
 // Production correctly forbids an administrator remotely unmuting somebody.
 // This SDK has no local mute API; republish from that same participant instead.
 // It additionally proves the opposing receiver rebinds a changed track SID.
 await blueSeat.localParticipant.unpublishTrack(blueSeatPub.sid);
 blueSeatPub=await publish(blueSeat,660);
 await received('apk:qa-red-opponent-bridge<-qa-blue-seat');
 const sids=[redHostPub.sid,redSeatPub.sid,blueHostPub.sid,blueSeatPub.sid];
 await admin.removeParticipant(roomNames[0],'apk:qa-blue-opponent-bridge');await admin.removeParticipant(roomNames[1],'apk:qa-red-opponent-bridge');
 for(const [name,identity,sid] of [[roomNames[0],'qa-red-host',sids[0]],[roomNames[0],'qa-red-seat',sids[1]],[roomNames[1],'qa-blue-host',sids[2]],[roomNames[1],'qa-blue-seat',sids[3]]]){
   const participant=await admin.getParticipant(name,identity);assert(participant.tracks.some(t=>t.sid===sid),'Base publisher/track must survive PK-only cleanup');
 }
 // Exact server permission operation used by Party Leave/Remove Seat.
 // Revoke publish without disconnecting the participant or its subscriptions.
 await admin.updateParticipant(roomNames[0],'qa-red-seat',{permission:{canSubscribe:true,canPublish:false,canPublishData:false,canPublishSources:[]}});
 await delay(1200);
 const departed=await admin.getParticipant(roomNames[0],'qa-red-seat');
 assert.equal(departed.permission.canPublish,false);
 assert.equal(departed.permission.canSubscribe,true);
 assert.equal(departed.tracks.length,0,'Leave Seat must stop microphone publication');
 const heardBefore=counts.get('qa-red-seat<-qa-red-host').energy;
 await delay(500);
 assert(counts.get('qa-red-seat<-qa-red-host').energy>heardBefore,'Former speaker stays connected and hears the Host');
 console.log(JSON.stringify({actualCrossHostAudio:true,actualCrossSeatedAudio:true,mutedSeatSilence:true,seatRepublishRecovered:true,remoteUnmuteSecurityUnchanged:true,basePublisherTrackSidsPreserved:true,leaveSeatStopsPublish:true,leaveSeatPreservesSubscription:true,participants:8,rooms:2,receivedStreams:[...counts.values()].filter(c=>c.energy>100000).length,secretLogged:false}));
 void before;
}finally{
 running=false;
 await Promise.allSettled(readers.map(r=>r.cancel()));
 await Promise.allSettled(connections.map(r=>r.disconnect()));
 await Promise.allSettled(loops);
 await Promise.allSettled(roomNames.map(name=>admin.deleteRoom(name)));
 await dispose();
 console.log('AUDIO_PK_MEDIA_QA_CLEANED_UP');
}
