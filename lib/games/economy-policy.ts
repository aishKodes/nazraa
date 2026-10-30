import {randomInt} from 'node:crypto';
import {mobileGamesConfig,type ConfigurableGameId,type GameRuntimeConfig} from './game-config';

export {gameNames} from './game-names';
export type EconomyDraft={enabled:boolean;maintenance:boolean;minimumBet:number;maximumBet:number;maximumPayoutMultiplier:number;payoutScalePpm:number;outcomeWeights?:number[];sideBetPayoutScalePpm?:number;saladWeight?:number;pizzaWeight?:number;poolContributionBps?:number;poolMinimumForSpecial?:number};
export function economyDraft(game:ConfigurableGameId,current:GameRuntimeConfig,draft:EconomyDraft){
  if(typeof draft.enabled!=='boolean'||typeof draft.maintenance!=='boolean')throw new Error('Choose valid availability.');
  for(const [key,min,max] of [['minimumBet',1,50_000_000],['maximumBet',1,game==='lion_vs_tiger'?Number.MAX_SAFE_INTEGER:50_000_000],['payoutScalePpm',1,5_000_000]] as const){
    const n=draft[key];if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Choose valid game limits and payout scale.');
  }
  if(!Number.isFinite(draft.maximumPayoutMultiplier)||draft.maximumPayoutMultiplier<1||draft.maximumPayoutMultiplier>1000||draft.maximumBet<draft.minimumBet)throw new Error('Choose valid game limits.');
  if(game==='teen_patti'&&(draft.minimumBet!==100||draft.maximumPayoutMultiplier!==3||draft.payoutScalePpm!==1_000_000))throw new Error('Princess must retain exactly 3.00× gross and its 3% fee.');
  if(game==='lion_vs_tiger'&&(draft.minimumBet!==1||draft.maximumBet!==Number.MAX_SAFE_INTEGER||draft.maximumPayoutMultiplier!==30||draft.payoutScalePpm!==1_000_000))throw new Error('Lion Vs Tiger has a protected fixed paytable and unrestricted stake sizing.');
  const adjustableWeights=game==='luck77'||game==='bounty_football';
  if(draft.outcomeWeights!==undefined){
    if(!adjustableWeights||draft.outcomeWeights.length!==(game==='luck77'?3:10)||draft.outcomeWeights.some(n=>!Number.isSafeInteger(n)||n<0||n>1_000_000)||!draft.outcomeWeights.some(n=>n>0))throw new Error('Choose valid outcome weights for this game.');
  }
  if(draft.sideBetPayoutScalePpm!==undefined&&(game!=='teen_patti_pro'||!Number.isSafeInteger(draft.sideBetPayoutScalePpm)||draft.sideBetPayoutScalePpm<1||draft.sideBetPayoutScalePpm>5_000_000))throw new Error('Choose a valid Crown payout scale.');
  for(const key of ['saladWeight','pizzaWeight','poolContributionBps','poolMinimumForSpecial'] as const){
    const n=draft[key],max=key==='poolContributionBps'?10_000:key==='poolMinimumForSpecial'?1_000_000_000:1_000_000;
    if(n!==undefined&&(game!=='greedy_king'||!Number.isSafeInteger(n)||n<0||n>max))throw new Error('Choose valid King special/pool parameters.');
  }
  const next={...current,...draft,outcomeWeights:draft.outcomeWeights??current.outcomeWeights};
  if(next.denominations.some(n=>n>next.maximumBet))throw new Error('Maximum bet must include the current chip denominations.');
  if(game!=='lion_vs_tiger' && (next.maximumBet!==current.maximumBet||next.maximumPayoutMultiplier!==current.maximumPayoutMultiplier||next.payoutScalePpm!==current.payoutScalePpm) &&
    next.maximumBet*next.maximumPayoutMultiplier>1_250_000_000)
    throw new Error('Choose limits whose maximum round return fits the existing 1,250,000,000-Coin settlement limit.');
  return mobileGamesConfig({games:{[game]:next}}).games[game];
}

/** Exact single-area distribution where the current canonical model permits.
 * No assertion of a universal RTP: selection mix, fees, floors, caps and
 * stateful special pools can change actual returns. */
export function economyModel(game:ConfigurableGameId,c:GameRuntimeConfig){
  if(game==='jungle_hunt')return {areas:[],note:'Multi-payline, capped reel game. No scalar RTP control; use the existing dedicated RTP verification suite.',average:null as number|null};
  if((game==='greedy_king')&&((c.saladWeight??0)>0||(c.pizzaWeight??0)>0))return {areas:[],note:'Stateful Salad/Pizza pools enabled. A static weighted-area model would be inaccurate.',average:null as number|null};
  const weights=game==='teen_patti'?[1,1,1]:game==='lion_vs_tiger'?[15,1,15]:c.outcomeWeights??[];
  const multipliers=game==='teen_patti'?[3,3,3]:game==='lion_vs_tiger'?[2,30,2]:game==='luck77'?[8,2,2]:game==='teen_patti_pro'?[2.7,2.9,2.8]:game==='greedy_lion'?[5,45,25,5,15,5,5,10]:game==='greedy_king'?[5,10,15,25,45,5,5,5]:[2,5,8,18,66,50,100,88,30,20];
  const labels=game==='teen_patti'?['Green','Blue','Red']:game==='lion_vs_tiger'?['Tiger','Draw','Lion']:game==='luck77'?['77','Watermelon','Plum']:multipliers.map((_,i)=>String(i+1));
  const total=weights.reduce((s,n)=>s+n,0);
  if(!total||weights.length!==multipliers.length)return {areas:[],average:null,note:'No verified probability model available for this configuration.'};
  const scale=game==='teen_patti'||game==='lion_vs_tiger'?1:c.payoutScalePpm/1_000_000;
  const areas=multipliers.map((m,i)=>{
    const gross=game==='teen_patti'||game==='lion_vs_tiger'?m:Math.min(m*scale,c.maximumPayoutMultiplier);
    const fee=game==='teen_patti'?.03:game==='lion_vs_tiger'?0:(c.settlementDeductionRate??.01);
    const net=gross*(gross>1?1-fee:1);
    return {label:labels[i],probability:weights[i]/total,netReturn:net,rtp:weights[i]/total*net};
  });
  if(game==='greedy_king'){
    for(const [label,indices,m] of [['Salad',[0,5,6,7],1.25],['Pizza',[1,2,3,4],4.37]] as const){
      const probability=indices.reduce<number>((s,i)=>s+weights[i],0)/total,gross=Math.min(m*scale,c.maximumPayoutMultiplier);
      const netReturn=gross*(gross>1?1-(c.settlementDeductionRate??.01):1);
      areas.push({label,probability,netReturn,rtp:probability*netReturn});
    }
  }
  const note=game==='teen_patti'&&c.princessPreviewQuotes?'Unconditional fair-deck symmetry only; visible cards change conditional odds. This is not guaranteed player-independent RTP.':game==='teen_patti_pro'?'Normal lanes only. Crown has a separate hand-category distribution and payout scale; excluded from this model.':'Single-area wagers, asymptotic before whole-Coin rounding. Multi-selection caps and selection mix may lower realized RTP.';
  return {areas,average:areas.reduce((s,a)=>s+a.rtp,0)/areas.length,note};
}

/** Wallet-free Monte Carlo of the disclosed single-area distribution. */
export async function simulateEconomy(game:ConfigurableGameId,c:GameRuntimeConfig,rounds:number){
  if(![100_000,1_000_000].includes(rounds))throw new Error('Choose 100,000 or 1,000,000 simulation rounds.');
  const model=economyModel(game,c);if(model.average==null)throw new Error(model.note);
  let sum=0,sumSquares=0,largest=0;const wins=model.areas.map(()=>0);
  for(let i=0;i<rounds;i++){
    const area=randomInt(model.areas.length),roll=randomInt(1_000_000_000)/1_000_000_000;
    const payout=roll<model.areas[area].probability?model.areas[area].netReturn:0;
    sum+=payout;sumSquares+=payout*payout;largest=Math.max(largest,payout);if(payout)wins[area]++;
    if(i%10_000===0)await new Promise<void>(resolve=>setImmediate(resolve));
  }
  return {rounds,theoreticalRtp:model.average,simulatedRtp:sum/rounds,variance:sumSquares/rounds-(sum/rounds)**2,largestPayoutPerUnit:largest,distribution:model.areas.map((a,i)=>({area:a.label,winningSamples:wins[i]})),note:model.note+' Equal random selection among modeled areas, one unit stake. No wallet transactions.'};
}
