import assert from 'node:assert/strict';
import {configurableGameIds,mobileGamesConfig,defaultMobileGamesConfig,type ConfigurableGameId} from '@/lib/games/game-config';
import {economyDraft,economyModel,simulateEconomy,type EconomyDraft} from '@/lib/games/economy-policy';
import {targetRtpPolicy,calculateTargetConfiguration} from '@/lib/games/target-rtp';
const defaults=mobileGamesConfig({});
function draftFor(game:ConfigurableGameId,target:number):EconomyDraft{const c=defaults.games[game];return {enabled:c.enabled,maintenance:c.maintenance,minimumBet:c.minimumBet,maximumBet:c.maximumBet,maximumPayoutMultiplier:c.maximumPayoutMultiplier,payoutScalePpm:c.payoutScalePpm,controlMode:'TARGET_RTP',targetRtp:target,denominations:c.denominations};}
async function main(){
const rows:unknown[]=[];
for(const game of configurableGameIds){
 const original=structuredClone(defaults.games[game]);
 const policy=targetRtpPolicy(game,original);
 if(!policy.editable){assert.throws(()=>calculateTargetConfiguration(game,original,.8),/TARGET NOT ACHIEVABLE/);rows.push({game,status:'PROTECTED',reason:policy.note,onlyTarget:game==='lion_vs_tiger'?30/31:null});continue;}
 for(const target of [.8,.9,.95]){
  const draft=draftFor(game,target);
  const result=economyDraft(game,original,draft),model=economyModel(game,result);
  assert(model.average!==null);assert(Math.abs(model.average-target)<.00001,game+' theoretical target');
  assert.equal(result.targetRtp,target);assert.equal(result.bettingSeconds,original.bettingSeconds);assert.equal(result.resultSeconds,original.resultSeconds);
  if(game!=='teen_patti')assert.deepEqual(result.outcomeWeights,original.outcomeWeights);
  if(game==='teen_patti_pro')assert.equal(result.sideBetPayoutScalePpm,original.sideBetPayoutScalePpm);
  rows.push({game,target,calculated:model.average,scalePpm:result.payoutScalePpm,model:policy.scope});
 }
 assert.throws(()=>calculateTargetConfiguration(game,original,1.2),/TARGET NOT ACHIEVABLE/);
 assert.throws(()=>economyDraft(game,original,{...draftFor(game,.8),denominations:[-1]}),/betting Coins/);
}
const c=defaults.games.luck77;
assert.throws(()=>economyDraft('luck77',c,{...draftFor('luck77',.8),denominations:[100,100]}),/betting Coins/);
assert.throws(()=>calculateTargetConfiguration('luck77',{...c,maximumPayoutMultiplier:1},.9),/TARGET NOT ACHIEVABLE/);
assert.throws(()=>calculateTargetConfiguration('greedy_king',{...defaults.games.greedy_king,saladWeight:1},.8),/TARGET NOT ACHIEVABLE/);
const simulations=[];
for(const game of ['teen_patti','luck77','greedy_lion','greedy_king','bounty_football','teen_patti_pro'] as ConfigurableGameId[]){
 const c=defaults.games[game],next=economyDraft(game,c,draftFor(game,.8));
 const sim=await simulateEconomy(game,next,100000);const standardError=Math.sqrt(sim.variance/sim.rounds);
 assert(Math.abs(sim.simulatedRtp-sim.theoreticalRtp)<6*standardError+.0001,game+' simulation');
 simulations.push({game,target:.8,theoretical:sim.theoreticalRtp,simulated:sim.simulatedRtp,standardError,n:sim.rounds,note:sim.note});
}
console.log(JSON.stringify({status:'PASS',rows,simulations,invalidTargetDenied:true,invalidDenominationsDenied:true,crownPreserved:true,productionSettingsChanged:false},null,2));

}
main().catch(e=>{console.error(e);process.exitCode=1;});
