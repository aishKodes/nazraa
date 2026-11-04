/** Shared, client-safe calculator. Publication re-runs the exact same calculator
 * against the locked current server configuration; client values are not authority. */
import type {ConfigurableGameId,GameRuntimeConfig} from './game-config';
import {economyModel} from './economy-model';
import {princessPrecommittedProfile} from './princess-contract';

function safeMaximumBet(game:ConfigurableGameId,c:GameRuntimeConfig,ceiling:number){
 if(game==='lion_vs_tiger')return c.maximumBet;
 const unit=game==='teen_patti'||game==='luck77'?100:game==='jungle_hunt'?150:500;
 return Math.min(c.maximumBet,Math.floor(1_250_000_000/ceiling/unit)*unit);
}

export function targetRtpPolicy(game:ConfigurableGameId,c:GameRuntimeConfig){
 const minimum=c.minimumTargetRtp??.5,maximum=c.maximumTargetRtp??.99;
 if(game==='lion_vs_tiger')return {minimum:30/31,maximum:30/31,editable:false,scope:'All three fixed-return outcomes',note:'Protected Tiger ×2 / Draw ×30 / Lion ×2 model. Its only valid target is 30/31 (96.774194%).'};
 if(game==='jungle_hunt')return {minimum,maximum,editable:false,scope:'Multi-payline reels',note:'TARGET NOT ACHIEVABLE WITH CURRENT PAYOUT MODEL: no verified scalar calculator for capped, overlapping reel payouts. The existing dedicated RTP verifier remains required.'};
 if(game==='greedy_king'&&((c.saladWeight??0)>0||(c.pizzaWeight??0)>0))return {minimum,maximum,editable:false,scope:'Stateful special pools',note:'TARGET NOT ACHIEVABLE WITH CURRENT PAYOUT MODEL: stateful Salad/Pizza pools have no verified scalar RTP range. Existing pool settings remain unchanged.'};
 return {minimum,maximum,editable:true,scope:game==='teen_patti'?'Every chair, before whole-Coin flooring':game==='teen_patti_pro'?'Normal lanes only; Crown is unchanged':'Equal single-area stake average',note:game==='teen_patti'?'Fixed per-chair returns use the existing disclosed, bet-independent weighted-deal model.':game==='teen_patti_pro'?'Crown has a separate hand-category distribution. This is not a claim about whole-game or Crown RTP.':'Multi-selection fee thresholds, whole-Coin rounding, payout caps and selection mix can change realized return. Probabilities are retained.'};
}
export function calculateTargetConfiguration(game:ConfigurableGameId,current:GameRuntimeConfig,target:number){
 const policy=targetRtpPolicy(game,current);
 if(!Number.isFinite(current.maximumPayoutMultiplier)||current.maximumPayoutMultiplier<1||current.maximumPayoutMultiplier>1000)throw Error('Choose a valid maximum payout multiplier.');
 if(!Number.isFinite(target)||target<policy.minimum-1e-10||target>policy.maximum+1e-10)throw Error(`TARGET NOT ACHIEVABLE WITH CURRENT PAYOUT MODEL. Permitted range ${(policy.minimum*100).toFixed(4)}%–${(policy.maximum*100).toFixed(4)}%.`);
 if(!policy.editable){
  if(Math.abs(target-current.targetRtp)>1e-9)throw Error(policy.note);
  return {targetRtp:current.targetRtp,payoutScalePpm:current.payoutScalePpm,maximumPayoutMultiplier:current.maximumPayoutMultiplier,maximumBet:safeMaximumBet(game,current,current.maximumPayoutMultiplier)};
 }
 if(game==='teen_patti'){
  const weights=current.princessPayoutProfile===princessPrecommittedProfile?current.outcomeWeights??[1,1,1]:[1,1,1];
  const sum=weights.reduce((a,b)=>a+b,0);
  if(weights.length!==3||weights.some(w=>w<=0))throw Error('Princess requires three valid chair probabilities.');
  // Preserve gross cap unless the explicitly previewed target requires a larger published return.
  const ceiling=Math.max(current.maximumPayoutMultiplier,Math.ceil(Math.max(...weights.map(w=>target*sum/w/.95))*1e6)/1e6);
  return {targetRtp:target,payoutScalePpm:1_000_000,maximumPayoutMultiplier:ceiling,maximumBet:safeMaximumBet(game,current,ceiling),princessPayoutProfile:princessPrecommittedProfile,princessServiceFeeBps:500,outcomeWeights:weights};
 }
 // Solve the canonical single-area model, including each area's payout ceiling
 // and existing fee discontinuity. Never adjust winner weights from wagers.
 let lo=1,hi=5_000_000;
 const at=(ppm:number)=>economyModel(game,{...current,payoutScalePpm:ppm}).average;
 const min=at(lo),max=at(hi);
 if(min==null||max==null)throw Error('TARGET NOT ACHIEVABLE WITH CURRENT PAYOUT MODEL. No verified probability model.');
 if(target<min-1e-8||target>max+1e-8)throw Error(`TARGET NOT ACHIEVABLE WITH CURRENT PAYOUT MODEL. Current mathematical range ${(min*100).toFixed(4)}%–${(max*100).toFixed(4)}%.`);
 while(lo<hi){const mid=Math.floor((lo+hi)/2),value=at(mid)!;if(value<target)lo=mid+1;else hi=mid;}
 const ppm=[lo,Math.max(1,lo-1)].reduce((best,n)=>Math.abs(at(n)!-target)<Math.abs(at(best)!-target)?n:best,lo);
 const calculated=at(ppm)!;
 if(Math.abs(calculated-target)>.00001)throw Error(`TARGET NOT ACHIEVABLE WITH CURRENT PAYOUT MODEL. Closest valid target ${(calculated*100).toFixed(5)}%.`);
 return {targetRtp:target,payoutScalePpm:ppm,maximumPayoutMultiplier:current.maximumPayoutMultiplier,maximumBet:safeMaximumBet(game,current,current.maximumPayoutMultiplier)};
}
