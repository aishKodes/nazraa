import type {ConfigurableGameId,GameRuntimeConfig} from './game-config';
import {princessPrecommittedProfile} from './princess-contract';
import {princessPrecommittedPaytable,princessNetReturn} from './princess-paytable';

/** Exact single-area distribution where the current canonical model permits.
 * No assertion of a universal RTP: selection mix, fees, floors, caps and
 * stateful special pools can change actual returns. */
export function economyModel(game:ConfigurableGameId,c:GameRuntimeConfig){
  if(game==='teen_patti'&&c.princessPayoutProfile===princessPrecommittedProfile){
    const table=princessPrecommittedPaytable(c);
    const areas=table.areas.map(a=>{const netReturn=a.netNumerator/a.netDenominator;return {label:a.chair,probability:a.probability,netReturn,rtp:a.probability*netReturn,chip100Rtp:a.probability*princessNetReturn(100,a.netNumerator,a.netDenominator)/100};});
    return {areas,average:areas.reduce((s,a)=>s+a.rtp,0)/3,note:'Disclosed precommitted weighted deal, not a uniform shuffle. Winner weights are independent of the opening cards and all wagers. Fixed per-chair returns; 5% fee. Whole-Coin net flooring can only reduce return. Bet/payout/exposure limits reject new wagers; accepted payouts are never clipped.'};
  }
  if(game==='jungle_hunt')return {areas:[],note:'Multi-payline, capped reel game. No scalar RTP control; use the existing dedicated RTP verification suite.',average:null as number|null};
  if((game==='greedy_king')&&((c.saladWeight??0)>0||(c.pizzaWeight??0)>0))return {areas:[],note:'Stateful Salad/Pizza pools enabled. A static weighted-area model would be inaccurate.',average:null as number|null};
  const weights=game==='teen_patti'?[1,1,1]:game==='lion_vs_tiger'?[15,1,15]:c.outcomeWeights??[];
  const multipliers=game==='teen_patti'?(c.princessPayoutProfile==='FAIR_90_FEE_5'?[54/19,54/19,54/19]:[3,3,3]):game==='lion_vs_tiger'?[2,30,2]:game==='luck77'?[8,2,2]:game==='teen_patti_pro'?[2.7,2.9,2.8]:game==='greedy_lion'?[5,45,25,5,15,5,5,10]:game==='greedy_king'?[5,10,15,25,45,5,5,5]:[2,5,8,18,66,50,100,88,30,20];
  const labels=game==='teen_patti'?['Green','Blue','Red']:game==='lion_vs_tiger'?['Tiger','Draw','Lion']:game==='luck77'?['77','Watermelon','Plum']:multipliers.map((_,i)=>String(i+1));
  const total=weights.reduce((s,n)=>s+n,0);
  if(!total||weights.length!==multipliers.length)return {areas:[],average:null,note:'No verified probability model available for this configuration.'};
  const scale=game==='teen_patti'||game==='lion_vs_tiger'?1:c.payoutScalePpm/1_000_000;
  const areas=multipliers.map((m,i)=>{
    const gross=game==='teen_patti'||game==='lion_vs_tiger'?m:Math.min(m*scale,c.maximumPayoutMultiplier);
    const fee=game==='teen_patti'?(c.princessServiceFeeBps??300)/10000:game==='lion_vs_tiger'?0:(c.settlementDeductionRate??.01);
    const net=game==='teen_patti'&&c.princessPayoutProfile==='FAIR_90_FEE_5'?2.7:gross*(gross>1?1-fee:1);
    return {label:labels[i],probability:weights[i]/total,netReturn:net,rtp:weights[i]/total*net};
  });
  if(game==='greedy_king'){
    for(const [label,indices,m] of [['Salad',[0,5,6,7],1.25],['Pizza',[1,2,3,4],4.37]] as const){
      const probability=indices.reduce<number>((s,i)=>s+weights[i],0)/total,gross=Math.min(m*scale,c.maximumPayoutMultiplier);
      const netReturn=gross*(gross>1?1-(c.settlementDeductionRate??.01):1);
      areas.push({label,probability,netReturn,rtp:probability*netReturn});
    }
  }
  const note=game==='teen_patti'&&c.princessPayoutProfile==='FAIR_90_FEE_5'?'Fair single deck, three symmetric chairs, fixed 54/19× gross and 5% fee. Gross and fee round up to whole Coins: every accepted 100-Coin chip increment pays exactly 2.70× net on a win. No wager-dependent outcome.':game==='teen_patti'&&c.princessPreviewQuotes?'Unconditional fair-deck symmetry only; visible cards change conditional odds. This is not guaranteed player-independent RTP.':game==='teen_patti_pro'?'Normal lanes only. Crown has a separate hand-category distribution and payout scale; excluded from this model.':'Single-area wagers, asymptotic before whole-Coin rounding. Multi-selection fee thresholds, caps, rounding and selection mix may change realized RTP.';
  return {areas,average:areas.reduce((s,a)=>s+a.rtp,0)/areas.length,note};
}
