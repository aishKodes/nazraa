// Normal authenticated reviewer-account API flow. No credential extraction,
// direct DB writes, financial actions, role overrides or real-owner messages.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin='https://api.nazraa.pixtra.site/api/v1/mobile';
const secret=process.env.NAZRAA_QA_PASSWORD;
if(!secret)throw new Error('QA credential must be supplied privately');
const tokens=[];
async function api(path,{token,body,method=body?'POST':'GET'}={}) {
 const r=await fetch(`${origin}/${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error(`${method} ${path}: HTTP ${r.status}`);
 return r.status===204?{}:await r.json();
}
async function login(username){
 const s=await api('session',{body:{reviewerAccess:true,username,password:secret,deviceLabel:'Approved Agency regression 20261025',deviceId:`qa-agency-${randomUUID()}`}});
 assert.equal(typeof s.token,'string');tokens.push(s.token);return s.token;
}
let host,viewer,agencyId,removed=false,approved=false;
async function restoreViewer(){
 if(!removed||approved)return;
 const p=await api('agency-join',{token:viewer,body:{publicId:agencyId}});
 await api('agency-membership-review',{token:host,body:{applicationId:p.id,decision:'APPROVED',reason:'Restore original QA membership after scoped regression'}});
}
try{
 host=await login('nazraa-play-host');viewer=await login('nazraa-play-viewer');
 const [h,v]=await Promise.all([api('agency',{token:host}),api('agency',{token:viewer})]);
 assert.equal(h.agency?.isOwner,true,'Only the existing test Agency owner may operate');
 agencyId=h.agency.id;
 assert.equal(v.agency?.id,agencyId,'Viewer must already belong to this same QA Agency');
 const profile=await api('profile',{token:viewer});
 const viewerId=String(profile.profile.id);
 for(const id of ['104390','263258','478343','490441','572257','960815']){
  const s=await api('agency-search',{token:viewer,body:{query:`  ${id}  `}});
  assert.equal(s.results[0]?.id,id);assert.equal(s.results[0].canApply,true);
 }
 for(const id of ['178915','784850','962212']){
  const s=await api('agency-search',{token:viewer,body:{query:id}});
  assert.equal(s.results[0]?.canApply,false);
 }
 console.log('PASS production search: five repaired Agencies + original approved Agency available; unresolved/duplicate legacy references accurately unavailable');
 await api('agency-host-remove',{token:host,body:{targetPublicId:viewerId,reason:'Temporary authorized QA reapplication to original QA Agency'}});removed=true;
 const pending=await Promise.all(Array.from({length:6},()=>api('agency-join',{token:viewer,body:{publicId:agencyId}})));
 assert.equal(new Set(pending.map(p=>p.id)).size,1);
 const owner=await api('agency',{token:host});
 assert(owner.agency.joinRequests.some(p=>p.id===pending[0].id));
 for(let i=0;i<2;i++)await api('agency-membership-review',{token:host,body:{applicationId:pending[0].id,decision:'APPROVED',reason:'Approved QA pending request; same original Agency restored'}});
 approved=true;
 const accepted=await api('agency',{token:viewer});assert.equal(accepted.agency.id,agencyId);
 console.log('PASS production Agency E2E: nonmember -> six idempotent pending requests -> owner sees request -> accepts twice safely -> authoritative membership refreshed; original QA association restored');
}finally{
 try{await restoreViewer();}finally{
  await Promise.all(tokens.map(token=>api('session',{token,method:'DELETE'})));
 }
}
