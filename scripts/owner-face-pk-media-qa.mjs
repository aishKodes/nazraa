// Isolated real WebRTC transport regression. Never accepts a production host.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AccessToken,RoomServiceClient} from 'livekit-server-sdk';
const rtc=await import(process.env.NAZRAA_RTC_NODE_MODULE??'@livekit/rtc-node');
const {Room,RoomEvent,AudioSource,AudioFrame,LocalAudioTrack,TrackPublishOptions,TrackSource,AudioStream,dispose}=rtc;
const url='ws://127.0.0.1:7880';
const admin=new RoomServiceClient('http://127.0.0.1:7880','devkey','secret');
const prefix='OWNER_STAGE_'+randomUUID().slice(0,8),names=[prefix+'_A',prefix+'_B'];
const rooms=[],sources=[],readers=[],loops=[],counts=new Map();let running=true;
async function join(board,identity,publish=false,opponentHost=null){
 const token=new AccessToken('devkey','secret',{identity,ttl:'5m'});
 token.addGrant({room:board,roomJoin:true,canPublish:publish,canSubscribe:true,canPublishData:false,canPublishSources:publish?[TrackSource.SOURCE_MICROPHONE]:[]});
 const room=new Room();rooms.push(room);
 const subscribe=(pub,p)=>{if(opponentHost&&p.identity===opponentHost&&pub.source===TrackSource.SOURCE_MICROPHONE)pub.setSubscribed(true);};
 room.on(RoomEvent.TrackPublished,subscribe);
 room.on(RoomEvent.TrackSubscribed,(track,pub,p)=>{
  const id=identity+'<-'+p.identity,c={frames:0,energy:0};counts.set(id,c);
  const reader=new AudioStream(track,16000,1).getReader();readers.push(reader);
  loops.push((async()=>{try{while(running){const {value,done}=await reader.read();if(done)break;c.frames++;for(const sample of value.data)c.energy+=Math.abs(sample);}}catch{}})());
 });
 await room.connect(url,await token.toJwt(),{autoSubscribe:opponentHost==null,dynacast:false});
 if(opponentHost)for(const p of room.remoteParticipants.values())for(const pub of p.trackPublications.values())subscribe(pub,p);
 return room;
}
async function publish(room,hz){
 const src=new AudioSource(16000,1);sources.push(src);
 const opts=new TrackPublishOptions();opts.source=TrackSource.SOURCE_MICROPHONE;
 const pub=await room.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('Staging microphone',src),opts);
 let offset=0;loops.push((async()=>{try{while(running){const data=new Int16Array(320);for(let i=0;i<320;i++)data[i]=Math.round(2000*Math.sin(2*Math.PI*hz*(offset+i)/16000));offset+=320;await src.captureFrame(new AudioFrame(data,16000,1,320));await delay(20);}}catch{}})());return pub;
}
async function audible(id){for(let i=0;i<50;i++){if((counts.get(id)?.energy??0)>100000)return;await delay(100);}assert.fail('No decoded audio: '+id);}
try{
 for(const n of names)await admin.createRoom({name:n,maxParticipants:15,emptyTimeout:15});
 const a=await join(names[0],'host-A',true),ag=await join(names[0],'guest-A',true),b=await join(names[1],'host-B',true),bg=await join(names[1],'guest-B',true);
 const ap=await publish(a,330),agp=await publish(ag,440),bp=await publish(b,550);await publish(bg,660);
 await join(names[1],'bridge-A',false,'host-B');await join(names[0],'bridge-B',false,'host-A');
 for(const id of ['host-A<-guest-A','host-B<-guest-B','bridge-A<-host-B','bridge-B<-host-A'])await audible(id);
 await delay(1500);assert(!counts.has('bridge-A<-guest-B'));assert(!counts.has('bridge-B<-guest-A'));
 await join(names[0],'audience-A');await delay(700);assert((await admin.getParticipant(names[0],'guest-A')).tracks.some(t=>t.sid===agp.sid));
 await admin.removeParticipant(names[1],'bridge-A');await join(names[1],'bridge-A',false,'host-B');await audible('bridge-A<-host-B');
 assert(!counts.has('bridge-A<-guest-B'));
 await admin.removeParticipant(names[0],'bridge-B');await admin.removeParticipant(names[1],'bridge-A');
 assert((await admin.getParticipant(names[0],'host-A')).tracks.some(t=>t.sid===ap.sid));assert((await admin.getParticipant(names[1],'host-B')).tracks.some(t=>t.sid===bp.sid));
 console.log(JSON.stringify({environment:'loopback-only LiveKit 1.13.7, synthetic audio',twoHostsAudible:true,ownGuestsAudible:true,opponentGuestAudioReceived:false,bridgeReconnectRecovered:true,audienceJoinPreservesGuest:true,pkCleanupPreservesHostTracks:true,decodedStreams:counts.size,productionTouched:false}));
}finally{
 running=false;await Promise.allSettled(readers.map(r=>r.cancel()));await Promise.allSettled(rooms.map(r=>r.disconnect()));await Promise.allSettled(loops);await Promise.allSettled(names.map(n=>admin.deleteRoom(n)));await dispose();
 console.log('ISOLATED_MEDIA_ROOMS_CLEANED');
}
