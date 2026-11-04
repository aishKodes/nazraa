import {economyModel} from './economy-model';
export {economyModel} from './economy-model';
import {calculateTargetConfiguration} from './target-rtp';
import {randomInt} from 'node:crypto';
import {mobileGamesConfig,type ConfigurableGameId,type GameRuntimeConfig} from './game-config';
import {princessPrecommittedProfile,princessPrecommittedPaytable,dealPrecommittedPrincess,princessNetReturn,princessDefaultSinglePayout,princessSettlementCeiling} from './princess-precommitted';
import {teenPattiCard,teenPattiChairs} from './teen-patti';

export {gameNames} from './game-names';
export type EconomyDraft={controlMode?:"TARGET_RTP";denominations?:number[];enabled:boolean;maintenance:boolean;minimumBet:number;maximumBet:number;maximumPayoutMultiplier:number;payoutScalePpm:number;outcomeWeights?:number[];sideBetPayoutScalePpm?:number;saladWeight?:number;pizzaWeight?:number;poolContributionBps?:number;poolMinimumForSpecial?:number;princessServiceFeeBps?:number;princessPayoutProfile?:GameRuntimeConfig['princessPayoutProfile'];targetRtp?:number;maximumSingleRoundPayout?:number;maximumRoundExposure?:number;bigWinThreshold?:number;bettingSeconds?:number;resultSeconds?:number};
export function economyDraft(game:ConfigurableGameId,current:GameRuntimeConfig,draft:EconomyDraft){
  if(draft.controlMode==='TARGET_RTP')draft={...draft,...calculateTargetConfiguration(game,{...current,maximumBet:draft.maximumBet,maximumPayoutMultiplier:draft.maximumPayoutMultiplier},draft.targetRtp??current.targetRtp),controlMode:'TARGET_RTP'};
  const weighted=game==='teen_patti'&&(draft.princessPayoutProfile??current.princessPayoutProfile)===princessPrecommittedProfile;
  if(typeof draft.enabled!=='boolean'||typeof draft.maintenance!=='boolean')throw new Error('Choose valid availability.');
  for(const [key,min,max] of [['minimumBet',1,50_000_000],['maximumBet',1,game==='lion_vs_tiger'?Number.MAX_SAFE_INTEGER:50_000_000],['payoutScalePpm',1,5_000_000]] as const){
    const n=draft[key];if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Choose valid game limits and payout scale.');
  }
  if(!Number.isFinite(draft.maximumPayoutMultiplier)||draft.maximumPayoutMultiplier<1||draft.maximumPayoutMultiplier>1000||draft.maximumBet<draft.minimumBet)throw new Error('Choose valid game limits.');
  if(game==='teen_patti'&&(draft.minimumBet!==100||(!weighted&&draft.maximumPayoutMultiplier!==3)||draft.payoutScalePpm!==1_000_000))throw new Error('Princess must retain its existing chips and choose a published paytable profile.');
  if(game==='lion_vs_tiger'&&(draft.minimumBet!==1||draft.maximumBet!==Number.MAX_SAFE_INTEGER||draft.maximumPayoutMultiplier!==30||draft.payoutScalePpm!==1_000_000))throw new Error('Lion Vs Tiger has a protected fixed paytable and unrestricted stake sizing.');
  if(draft.princessServiceFeeBps!==undefined&&(game!=='teen_patti'||!Number.isSafeInteger(draft.princessServiceFeeBps)||draft.princessServiceFeeBps<0||draft.princessServiceFeeBps>2500))throw new Error('Choose a valid Princess service fee (0–2500 basis points).');
  const adjustableWeights=game==='luck77'||game==='bounty_football'||weighted;
  if(draft.outcomeWeights!==undefined){
    if(game==='teen_patti'&&!weighted){if(JSON.stringify(draft.outcomeWeights)!=='[1,1,1]')throw Error('Princess legacy profiles retain their fair-deck probabilities.');}
    else if(!adjustableWeights||draft.outcomeWeights.length!==(game==='luck77'||weighted?3:10)||draft.outcomeWeights.some(n=>!Number.isSafeInteger(n)||n<(weighted?1:0)||n>1_000_000)||!draft.outcomeWeights.some(n=>n>0))throw new Error('Choose valid outcome weights for this game.');
  }
  if(draft.sideBetPayoutScalePpm!==undefined&&(game!=='teen_patti_pro'||!Number.isSafeInteger(draft.sideBetPayoutScalePpm)||draft.sideBetPayoutScalePpm<1||draft.sideBetPayoutScalePpm>5_000_000))throw new Error('Choose a valid Crown payout scale.');
  for(const key of ['saladWeight','pizzaWeight','poolContributionBps','poolMinimumForSpecial'] as const){
    const n=draft[key],max=key==='poolContributionBps'?10_000:key==='poolMinimumForSpecial'?1_000_000_000:1_000_000;
    if(n!==undefined&&(game!=='greedy_king'||!Number.isSafeInteger(n)||n<0||n>max))throw new Error('Choose valid King special/pool parameters.');
  }
  if(draft.princessPayoutProfile!==undefined&&(game!=='teen_patti'||!['LEGACY_FIXED_3X','FAIR_90_FEE_5',princessPrecommittedProfile].includes(draft.princessPayoutProfile)))throw Error('Choose a valid Princess profile.');
  for(const [key,min,max]of [['maximumSingleRoundPayout',100,princessSettlementCeiling],['maximumRoundExposure',100,princessSettlementCeiling],['bigWinThreshold',1,1_000_000_000],['bettingSeconds',1,300],['resultSeconds',1,60]] as const){
    const n=draft[key];if(n!==undefined&&(game!=='teen_patti'||!Number.isSafeInteger(n)||n<min||n>max))throw Error('Choose valid Princess limits, display threshold and timings.');
  }
  if(draft.targetRtp!==undefined&&game!=='teen_patti'&&draft.controlMode!=='TARGET_RTP')throw Error('Choose the Target RTP control to calculate this game configuration.');
  if(draft.denominations!==undefined){
    const unit=game==='luck77'||game==='teen_patti'?100:game==='lion_vs_tiger'?1:game==='jungle_hunt'?150:500;
    if(draft.denominations.length<1||draft.denominations.length>12||new Set(draft.denominations).size!==draft.denominations.length||draft.denominations.some(n=>!Number.isSafeInteger(n)||n<draft.minimumBet||n>draft.maximumBet||n%unit!==0))throw Error('Choose positive, unique betting Coins within the minimum/maximum and canonical chip unit.');
    if(game==='teen_patti'&&JSON.stringify(draft.denominations)!=='[100,1000,10000,100000]')throw Error('Princess retains the existing fixed betting Coins.');
    if(game==='lion_vs_tiger'&&JSON.stringify(draft.denominations)!==JSON.stringify(current.denominations))throw Error('Lion Vs Tiger retains its published chips.');
  }
  const next={...current,...draft,outcomeWeights:draft.outcomeWeights??current.outcomeWeights};
  if(next.denominations.some(n=>n>next.maximumBet))throw new Error('Maximum bet must include the current chip denominations.');
  if(game!=='lion_vs_tiger' && (next.maximumBet!==current.maximumBet||next.maximumPayoutMultiplier!==current.maximumPayoutMultiplier||next.payoutScalePpm!==current.payoutScalePpm) &&
    next.maximumBet*next.maximumPayoutMultiplier>1_250_000_000)
    throw new Error('Choose limits whose maximum round return fits the existing 1,250,000,000-Coin settlement limit.');
  if(game==='teen_patti'){
    next.princessPreviewQuotes=false;next.princessServiceFeeBps=draft.princessServiceFeeBps??current.princessServiceFeeBps??300;next.princessPayoutProfile=draft.princessPayoutProfile??current.princessPayoutProfile??'LEGACY_FIXED_3X';
    if(weighted){
      next.targetRtp=draft.targetRtp??(current.princessPayoutProfile===princessPrecommittedProfile?current.targetRtp:.8);
      next.outcomeWeights=draft.outcomeWeights??(current.princessPayoutProfile===princessPrecommittedProfile?current.outcomeWeights:[1,1,1]);
      next.maximumSingleRoundPayout=draft.maximumSingleRoundPayout??current.maximumSingleRoundPayout??princessDefaultSinglePayout;
      next.maximumRoundExposure=draft.maximumRoundExposure??current.maximumRoundExposure??princessSettlementCeiling;
      if(next.maximumSingleRoundPayout>next.maximumRoundExposure)throw Error('Choose a table exposure at least as large as the single-player payout limit.');
      princessPrecommittedPaytable(next);
    }else if(next.princessPayoutProfile==='FAIR_90_FEE_5'){if(next.princessServiceFeeBps!==500)throw Error('Princess 90% profile retains the published 5% fee.');next.targetRtp=.9;}
    else next.targetRtp=1-next.princessServiceFeeBps/10000;
    next.denominations=[100,1000,10000,100000];
  }
  return mobileGamesConfig({games:{[game]:next}}).games[game];
}

/** Wallet-free Monte Carlo of the disclosed single-area distribution. */
export async function simulateEconomy(game:ConfigurableGameId,c:GameRuntimeConfig,rounds:number){
  if(![100_000,1_000_000].includes(rounds))throw new Error('Choose 100,000 or 1,000,000 simulation rounds.');
  const model=economyModel(game,c);if(model.average==null)throw new Error(model.note);
  if(game==='teen_patti'&&c.princessPayoutProfile===princessPrecommittedProfile){
    const table=princessPrecommittedPaytable(c),wins=[0,0,0];let sum=0,sumSquares=0,openingStrategyPaid=0;
    for(let i=0;i<rounds;i++){
      const dealt=dealPrecommittedPrincess(table.weights),winner=teenPattiChairs.indexOf(dealt.winner),area=randomInt(3);
      wins[winner]++;
      const payout=winner===area?princessNetReturn(100,table.areas[area].netNumerator,table.areas[area].netDenominator)/100:0;
      sum+=payout;sumSquares+=payout*payout;
      let strongest=0;
      for(let j=1;j<3;j++){const a=teenPattiCard(dealt.hands[j].cards[0]),b=teenPattiCard(dealt.hands[strongest].cards[0]);if(a.rank>b.rank||a.rank===b.rank&&a.suit>b.suit)strongest=j;}
      if(strongest===winner)openingStrategyPaid+=princessNetReturn(100,table.areas[strongest].netNumerator,table.areas[strongest].netDenominator);
      if(i%1000===0)await new Promise<void>(resolve=>setImmediate(resolve));
    }
    return {rounds,theoreticalRtp:model.average,simulatedRtp:sum/rounds,variance:sumSquares/rounds-(sum/rounds)**2,
      largestPayoutPerUnit:Math.max(...table.areas.map(a=>a.netNumerator/a.netDenominator)),
      distribution:model.areas.map((a,i)=>({area:a.label,winningSamples:wins[i]})),openingCardStrategyRtp:openingStrategyPaid/(rounds*100),
      note:model.note+' Actual 52-card weighted deals; one random chair per round, 100-Coin stake. Highest-opening-card strategy also measured. No wallet transactions.'};
  }
  let sum=0,sumSquares=0,largest=0;const wins=model.areas.map(()=>0);
  for(let i=0;i<rounds;i++){
    const area=randomInt(model.areas.length),roll=randomInt(1_000_000_000)/1_000_000_000;
    const payout=roll<model.areas[area].probability?model.areas[area].netReturn:0;
    sum+=payout;sumSquares+=payout*payout;largest=Math.max(largest,payout);if(payout)wins[area]++;
    if(i%10_000===0)await new Promise<void>(resolve=>setImmediate(resolve));
  }
  return {rounds,theoreticalRtp:model.average,simulatedRtp:sum/rounds,variance:sumSquares/rounds-(sum/rounds)**2,largestPayoutPerUnit:largest,distribution:model.areas.map((a,i)=>({area:a.label,winningSamples:wins[i]})),note:model.note+' Equal random selection among modeled areas, one unit stake. No wallet transactions.'};
}
