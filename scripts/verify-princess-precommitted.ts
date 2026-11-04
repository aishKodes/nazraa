import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {dealChairRound,chairPreview,teenPattiCard,teenPattiChairs,compareChairHands} from '../lib/games/teen-patti';
import {princessNinetyQuote,princessNinetyRules,princessSettlement,commitPrincessQuote,requiresPrincessQuoteAcknowledgement} from '../lib/games/princess-preview-pricing';
import {mobileGamesConfig,snapshotGameConfig} from '../lib/games/game-config';
import {economyDraft,economyModel} from '../lib/games/economy-policy';
import {dealPrecommittedPrincess,princessPrecommittedQuote,princessPrecommittedPaytable,princessNetReturn,assertPrincessExposure,princessPrecommittedRules,princessPrecommittedProfile} from '../lib/games/princess-precommitted';
const before=mobileGamesConfig({games:{teen_patti:{princessPayoutProfile:'FAIR_90_FEE_5',princessServiceFeeBps:500,economyVersion:30,bettingSeconds:10,resultSeconds:3}}}).games.teen_patti;
const next={...economyDraft('teen_patti',before,{enabled:true,maintenance:false,minimumBet:100,maximumBet:before.maximumBet,maximumPayoutMultiplier:3,payoutScalePpm:1000000,princessServiceFeeBps:500,princessPayoutProfile:princessPrecommittedProfile,targetRtp:.8,outcomeWeights:[1,1,1],maximumSingleRoundPayout:150000000,maximumRoundExposure:1250000000,bigWinThreshold:50000,bettingSeconds:11,resultSeconds:4}),economyVersion:31};
assert.equal(next.bettingSeconds,before.bettingSeconds+1);assert.equal(next.resultSeconds,before.resultSeconds+1);assert.equal(next.drawingSeconds,before.drawingSeconds);
assert(Math.abs(economyModel('teen_patti',next).average!-.8)<1e-12);assert.equal(snapshotGameConfig('teen_patti',{...before,runtimeSnapshotVersion:1},next).targetRtp,.9);
assert.deepEqual(next.denominations,[100,1000,10000,100000]);
const totals=[0,0,0],win=[0,0,0],openingTotal=[0,0,0],openingWins=[0,0,0];let sum=0,sum2=0,strategy=0,oldStrategy=0;
for(let n=0;n<100000;n++){
 const dealt=dealPrecommittedPrincess([1,1,1]),index=teenPattiChairs.indexOf(dealt.winner),q=princessPrecommittedQuote(dealt.hands.map(h=>h.cards[0]),next);
 assert.equal(new Set(dealt.hands.flatMap(h=>h.cards)).size,9);
 for(let i=0;i<3;i++)assert(compareChairHands(dealt.hands[index].cards,dealt.hands[i].cards)>=0);
 const o={...dealt,rulesVersion:princessPrecommittedRules,pricing:q,...commitPrincessQuote(dealt.hands,q)};
 const preview=chairPreview(o);assert.equal(preview.quoteId,undefined);assert.equal(preview.paytableQuoteId,undefined);assert.equal(preview.termsQuoteId,o.commitment);assert.equal(preview.cards?.length,3);assert(requiresPrincessQuoteAcknowledgement(preview.rulesVersion));
 const area=randomInt(3);totals[area]++;if(index===area)win[area]++;
 const r=princessSettlement({[teenPattiChairs[area]]:100},o,next);assert.equal(r.payout,index===area?240:0);sum+=r.payout;sum2+=(r.payout/100)**2;
 let strongest=0;for(let j=1;j<3;j++){const a=teenPattiCard(dealt.hands[j].cards[0]),b=teenPattiCard(dealt.hands[strongest].cards[0]);if(a.rank>b.rank||a.rank===b.rank&&a.suit>b.suit)strongest=j;}
 openingTotal[strongest]++;if(strongest===index){openingWins[strongest]++;strategy+=240;}
 const fair=dealChairRound();let high=0;for(let j=1;j<3;j++){const a=teenPattiCard(fair.hands[j].cards[0]),b=teenPattiCard(fair.hands[high].cards[0]);if(a.rank>b.rank||a.rank===b.rank&&a.suit>b.suit)high=j;}
 if(teenPattiChairs[high]===fair.winner)oldStrategy+=270;
 if(n<50){
  for(const amount of [100,1000,10000,100000,99900,123400,50000000]){const p=princessSettlement({[dealt.winner]:amount},o,next);assert.equal(p.payout,amount*2.4);assert.equal(p.grossPayout-p.serviceFee,p.payout);assert.equal(p.serviceFee,Math.ceil(p.grossPayout*.05));}
  for(const key of ['feeBps','probabilityWeights','grossNumerators','netNumerators','targetRtpPpm','profileId','rounding','maximumBet','configVersion']){const forged={...q,[key]:0};assert.throws(()=>princessSettlement({green:100},{...o,pricing:forged,...commitPrincessQuote(dealt.hands,forged as typeof q)},next));}
  assert.throws(()=>princessSettlement({[dealt.winner]:100},o,{...next,economyVersion:32}),/configuration/);
  const old=princessNinetyQuote();assert.equal(princessSettlement({[fair.winner]:100},{...fair,rulesVersion:princessNinetyRules,pricing:old,...commitPrincessQuote(fair.hands,old)}).payout,270);
 }
}
const simulated=sum/100000/100,se=Math.sqrt((sum2/100000-simulated**2)/100000);assert(Math.abs(simulated-.8)<5*se);assert(Math.abs(strategy/1e7-.8)<.025);
const limited={...next,maximumBet:100000,maximumSingleRoundPayout:2400,maximumRoundExposure:4800};
assert.equal(assertPrincessExposure(limited,[{application_user_id:'a',target_id:'green',amount:1000}],'b',{green:1000}),0);
assert.throws(()=>assertPrincessExposure(limited,[{application_user_id:'a',target_id:'green',amount:1100}],'b',{green:1000}),/exposure/);
assert.throws(()=>assertPrincessExposure(limited,[],'b',{red:1100}),/payout/);
assert.throws(()=>assertPrincessExposure({...limited,maximumBet:1000},[],'b',{green:600,red:500}),/bet limit/);
assert.throws(()=>assertPrincessExposure(limited,[{application_user_id:'x',target_id:'green',amount:NaN}],'b',{red:100}),/unavailable/);
for(const weights of [[1,1,1],[2,3,5],[10,1,2]]){
 const table=princessPrecommittedPaytable({...next,maximumPayoutMultiplier:100,outcomeWeights:weights});
 for(const a of table.areas){assert(Math.abs(a.probability*a.netNumerator/a.netDenominator-.8)<1e-12);for(const amount of [100,1000,123400,50000000])assert(princessNetReturn(amount,a.netNumerator,a.netDenominator)<=amount*a.netNumerator/a.netDenominator+1e-7);}
}
assert.throws(()=>princessPrecommittedPaytable({...next,outcomeWeights:[1,0,1]}));assert.throws(()=>princessPrecommittedPaytable({...next,outcomeWeights:[1,100,1]}),/ceiling/);
console.log(JSON.stringify({rounds:100000,theoreticalRtp:.8,simulatedRtp:simulated,standardError:se,openingCardStrategyRtp:strategy/1e7,previousFairDealOpeningCardStrategyRtp:oldStrategy/1e7,randomChairWagers:totals,randomChairWins:win,highestOpeningCardSamples:openingTotal,highestOpeningCardWins:openingWins,netWinMultiplier:2.4,grossFraction:'48/19',serviceFeeBps:500,newConfig:next,validDeckAndStrongestHand:100000,feeAndRounding:true,legacySnapshotsPreserved:true,frozenConfigValidation:true,allSideExposureAdmission:true,tamperTests:true},null,2));
