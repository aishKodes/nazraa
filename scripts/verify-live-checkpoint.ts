import assert from 'node:assert/strict';
import {publishingCheckpoint as step} from '../lib/services/live-session-checkpoint';
const start=new Date('2026-10-17T00:00:00Z');
let cursor:Date|null=start,total=0;
for(let n=1;n<=100;n++){
  const r=step({wasPublishing:true,publishingNow:true,previousEvidence:cursor,serverTime:new Date(+start+n*20900),evidenceWindowSeconds:30});
  total+=r.seconds;cursor=r.cursor;
}
assert.equal(total,2090,'100 ×20.9s must retain 90 seconds formerly lost to checkpoint truncation');
const normal={wasPublishing:true,publishingNow:true,previousEvidence:start,evidenceWindowSeconds:30};
assert.equal(step({...normal,serverTime:start}).seconds,0,'duplicate checkpoint');
assert.equal(step({...normal,serverTime:new Date(+start-1000)}).seconds,0,'out-of-order/future cursor');
assert.equal(step({...normal,serverTime:new Date(+start+31000)}).seconds,0,'delayed heartbeat cannot invent a missing interval');
for(const offline of [10000,30000,301000]){
 const recovered=step({...normal,wasPublishing:false,serverTime:new Date(+start+offline)});
 assert.equal(recovered.seconds,0,'reconnect/offline does not accrue');
 const resumed=step({...normal,previousEvidence:recovered.cursor,serverTime:new Date(+start+offline+20000)});
 assert.equal(resumed.seconds,20,'same session resumes from durable committed progress');
}
assert.equal(step({...normal,publishingNow:false,serverTime:new Date(+start+20900)}).seconds,20,'terminal bounded flush');
assert.equal(step({...normal,previousEvidence:null,serverTime:start}).seconds,0,'process restart/fresh segment');
console.log('PASS live checkpoints: exact fractional carry; duplicate/out-of-order/delayed heartbeats; 10/30/301s offline; bounded finalization and resume; server timestamps only.');
