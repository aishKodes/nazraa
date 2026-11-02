import assert from 'node:assert/strict';
import {dealChairRound,chairPreview} from '../lib/games/teen-patti';
import {princessHiddenQuote,princessHiddenConfigRules,princessFixedQuote,princessFixedQuoteRules,princessSettlement,commitPrincessQuote} from '../lib/games/princess-preview-pricing';
import {mobileGamesConfig,snapshotGameConfig} from '../lib/games/game-config';
import {economyDraft,economyModel} from '../lib/games/economy-policy';
const before=mobileGamesConfig({games:{teen_patti:{princessPreviewQuotes:true,economyVersion:28}}}).games.teen_patti;
const next=economyDraft('teen_patti',before,{enabled:true,maintenance:false,minimumBet:100,maximumBet:before.maximumBet,maximumPayoutMultiplier:3,payoutScalePpm:1000000,princessServiceFeeBps:500});
assert.equal(next.princessPreviewQuotes,false);assert.equal(next.targetRtp,.95);assert(Math.abs(economyModel('teen_patti',next).average!-.95)<1e-12);
assert.deepEqual(next.denominations,[100,1000,10000,100000]);
assert.equal(snapshotGameConfig('teen_patti',{...before,runtimeSnapshotVersion:1},next).princessServiceFeeBps,300);
const dealt=dealChairRound(),oldQuote=princessFixedQuote(dealt.hands.map(h=>h.cards[0]));
const legacy={...dealt,rulesVersion:princessFixedQuoteRules,pricing:oldQuote,...commitPrincessQuote(dealt.hands,oldQuote)};
assert.equal(princessSettlement({[dealt.winner]:100},legacy).payout,291,'old committed fee remains 3%');
const quote=princessHiddenQuote(500);let paid=0,sumSquares=0,largest=0;const wins={green:0,blue:0,red:0};
for(let i=0;i<100000;i++){
 const d=dealChairRound();wins[d.winner]++;
 const o={...d,rulesVersion:princessHiddenConfigRules,pricing:quote,...commitPrincessQuote(d.hands,quote)};
 assert.equal(chairPreview(o).cards,undefined);assert.equal(chairPreview(o).feeBps,500);
 const r=princessSettlement({green:100},o);assert.equal(r.grossPayout,d.winner==='green'?300:0);assert.equal(r.serviceFee,d.winner==='green'?15:0);
 paid+=r.payout;sumSquares+=(r.payout/100)**2;largest=Math.max(largest,r.payout);
 if(i===0){assert.equal(princessSettlement({[d.winner]:1000},o).payout,2850);assert.deepEqual(princessSettlement({green:100},o),r);assert.throws(()=>princessSettlement({green:100},{...o,pricing:{...quote,feeBps:499}}),/commitment/);}
}
const mean=paid/100000/100;assert(Math.abs(mean-.95)<.02);
console.log(JSON.stringify({rounds:100000,theoreticalRtp:.95,simulatedRtp:mean,variance:sumSquares/100000-mean*mean,largestPayoutCoinsFor100Stake:largest,largestPayoutPerUnit:largest/100,houseEdge:.05,serviceFeeBps:500,winningChairs:wins,outcomesIndependentOfWagers:true,legacySnapshotsPreserved:true,allCardsHiddenDuringBetting:true}));
