// Direct HTTP parity on disposable localhost data only; no production secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
const q=JSON.parse(await fs.readFile('/tmp/nazraa-owner-staging-fixtures.json','utf8'));
assert.match(q.database,/^nazraa_mobile_qa_\d+$/);
async function call(path,index,body){const r=await fetch('http://127.0.0.1:3998/api/v1/mobile/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(index>=0?{authorization:'Bearer '+q.fixtures[index].token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
const c=await mysql.createConnection({host:'127.0.0.1',user:'root',database:q.database});
try{
 const input={roomCode:q.partyRoomCode,giftId:'qa_lucky',recipientPublicId:q.fixtures[1].publicId,quantity:2,clientGiftId:randomUUID()};
 const r=await call('gifts',0,input);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.totalCoins,200);assert.equal(r.data.totalNetDiamonds,40);assert.equal(r.data.event.platformFee,undefined);assert(!JSON.stringify(r.data).includes('companyAllocation'));assert(!JSON.stringify(r.data).includes('"weight"'));
 const replay=await call('gifts',0,input);assert.equal(replay.status,200);assert(replay.data.replayed);assert.deepEqual(replay.data.luckyOutcome,r.data.luckyOutcome);assert.equal(replay.data.event,null);
 assert.equal((await call('gifts',-1,input)).status,401);
 const music=await call('party-music',1,{roomCode:q.partyRoomCode,action:'local-start',fileName:'Owner tune.mp3'});assert.equal(music.status,200,JSON.stringify(music.data));assert.equal(music.data.state.controllerId,q.fixtures[1].publicId);
 assert((await call('party-music',0,{roomCode:q.partyRoomCode,action:'pause',generation:music.data.state.generation})).status>=400);
 assert.equal((await call('party-music',1,{roomCode:q.partyRoomCode,action:'stop',generation:music.data.state.generation})).status,200);
 const token=await call('livekit-token',1,{roomId:q.partyRoomCode,publish:true});assert.equal(token.status,200,JSON.stringify({...token.data,participantToken:'REDACTED'}));assert(token.data.participantToken.length>100);assert.equal(new URL(token.data.serverUrl).hostname,'127.0.0.1');
 const report={scope:'disposable localhost only',luckyQuantity:2,gross:200,recipientDiamonds:40,privateWeightsAbsent:true,unauthenticatedDenied:true,retrySameOutcome:true,musicHostAllowed:true,musicViewerDenied:true,liveKitHostTokenIssued:true};await fs.writeFile('/tmp/nazraa-music-lucky-http-results.json',JSON.stringify(report,null,2));console.log('PASS HTTP',JSON.stringify(report));
}finally{await c.end();}
