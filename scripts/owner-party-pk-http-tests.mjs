// Uses only the disposable localhost fixtures created by the owner suite.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
const q=JSON.parse(await readFile('/tmp/nazraa-owner-staging-fixtures.json','utf8'));
assert.match(q.database,/^nazraa_mobile_qa_\d+$/);
const root=await mysql.createConnection({host:'127.0.0.1',user:'root',database:q.database});
await root.query("SET time_zone='+00:00'");
async function call(path,index=0,body){const r=await fetch('http://127.0.0.1:3998/api/v1/mobile/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(index<0?{}:{authorization:'Bearer '+q.fixtures[index].token})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
try{
 const sender=q.fixtures[0];const [before]=await root.query("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);
 const intent={clientGiftId:randomUUID(),roomCode:q.partyRoomCode,giftId:'qa_stage_100',recipientPublicId:'0',recipientMode:'ALL',quantity:1};
 const responses=await Promise.all(Array.from({length:5},()=>call('gifts',0,intent)));
 for(const r of responses)assert.equal(r.status,200);
 const fresh=responses.filter(r=>!r.data.replayed);assert.equal(fresh.length,1);assert.equal(fresh[0].data.recipientCount,2);assert.equal(fresh[0].data.totalCoins,200);assert.equal(fresh[0].data.totalNetDiamonds,170);assert.equal(fresh[0].data.totalPlatformFee,30);
 const [after]=await root.query("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[sender.userId]);assert.equal(Number(before[0].available_balance)-Number(after[0].available_balance),200);
 assert.equal((await call('gifts',-1,intent)).status,401);
 const [claims]=await root.query('SELECT id FROM pk_reward_claims WHERE application_user_id=? ORDER BY created_at DESC',[q.fixtures[4].userId]);
 const denied=await call('random-pk-reward-claim',0,{rewardId:claims[0].id});assert(denied.status>=400);assert.match(denied.data.message,/unavailable/);
 const replays=await Promise.all(Array.from({length:4},()=>call('random-pk-reward-claim',4,{rewardId:claims[0].id})));assert(replays.every(r=>r.status===200&&r.data.replayed&&r.data.creditedCoins===0));
 const rewards=await call('daily-rewards',4);assert.equal(rewards.data.dailyRewards.checkInVisible,false);assert(Array.isArray(rewards.data.liveRewards));
 const pk=await call('pk-battle',3,{roomCode:q.faceRoomCode});assert.equal(pk.status,200);assert(pk.data.pkSession.sourceHost.id===q.fixtures[2].publicId);assert(!('peerGuestProfiles' in pk.data.pkSession));
 const report={base:'localhost:3998; isolated disposable MySQL',apiAuthRequired:true,allRecipients:2,allGross:200,allNet:170,allFee:30,retries:5,settlements:1,foreignRewardClaimDenied:true,claimedRewardRetriesNoCredit:true,checkInHidden:true,liveRewardsStillPresent:true,canonicalPkHostIdentity:true,productionTouched:false};
 await writeFile('/tmp/nazraa-owner-http-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await root.end();}
