import assert from 'node:assert/strict';
import {evaluateChairHand,compareChairHands,chairOutcomeFromDeck,dealChairRound,chairSettlement,chairPreview,teenPattiChairs} from '../lib/games/teen-patti';
import {mobileGamesConfig} from '../lib/games/game-config';

export function verifyTeenPattiChairRules(){
 const counts=[0,0,0,0,0,0];
 for(let a=0;a<50;a++)for(let b=a+1;b<51;b++)for(let c=b+1;c<52;c++)counts[evaluateChairHand([a,b,c]).category]++;
 assert.deepEqual(counts,[16440,3744,1096,720,48,52],'all 22,100 standard-deck hands have exactly the six approved categories');
 const ordered=[[12,25,38],[51,50,49],[12,24,36],[51,50,48],[12,25,50],[12,24,35]];
 for(let i=0;i<5;i++)assert(compareChairHands(ordered[i],ordered[i+1])>0);
 assert(compareChairHands([51,50,49],[51,39,40])>0,'AKQ > A23');
 assert(compareChairHands([51,39,40],[50,49,48])>0,'A23 > KQJ');
 assert.equal(evaluateChairHand([50,38,13]).category,0,'KA2 is not a sequence');
 assert(compareChairHands([11,24,27],[12,13,26])>0,'Pair rank before kicker');
 for(let suit=3;suit>0;suit--)assert(compareChairHands([suit*13+12,0,14],[(suit-1)*13+12,13,1])>0,'Spades > Hearts > Clubs > Diamonds after identical point values');
 assert.throws(()=>evaluateChairHand([0,0,1]));assert.throws(()=>chairOutcomeFromDeck(Array(52).fill(0)));
 assert.deepEqual(chairSettlement({red:110000,blue:95000},'red'),{wager:205000,grossPayout:330000,serviceFee:9900,payout:320100},'exact video example');
 assert.deepEqual(chairSettlement({green:100,blue:100,red:100},'green'),{wager:300,grossPayout:300,serviceFee:9,payout:291},'fee applies even with no overall net profit');
 assert.equal(chairSettlement({red:100},'blue').payout,0);
 assert.throws(()=>chairSettlement({crown:500},'green'));
 assert.throws(()=>chairSettlement({green:1},'green'));
 const wins=[0,0,0];
 for(let i=0;i<5000;i++){
  const outcome=dealChairRound();const cards=outcome.hands.flatMap(h=>h.cards);
  assert.deepEqual(chairPreview(outcome),{},'no informational betting advantage: all nine dealt cards are hidden');
  assert.deepEqual(chairPreview(outcome,false),{},'HTTP and WS betting policy is fail-closed and safe for old APKs');
  assert.deepEqual(chairPreview(outcome,true).cards,outcome.hands.map(h=>h.cards[0]),'first-card reveal only after betting deadline');
  assert.equal(cards.length,9);assert.equal(new Set(cards).size,9);
  const winner=teenPattiChairs.indexOf(outcome.winner);wins[winner]++;
  for(let h=0;h<3;h++)if(h!==winner)assert(compareChairHands(outcome.hands[winner].cards,outcome.hands[h].cards)>0,'server winner is the exact strongest dealt hand');
 }
 assert(wins.every(n=>Math.abs(n/5000-1/3)<.05));
 const fixed=mobileGamesConfig({games:{teen_patti:{payoutScalePpm:50000,maximumPayoutMultiplier:100,outcomeWeights:[100,0,0]}}}).games.teen_patti;
 assert.equal(fixed.payoutScalePpm,1000000);assert.equal(fixed.maximumPayoutMultiplier,3);assert.equal(fixed.outcomeWeights,undefined);
 assert.equal(chairSettlement({green:100,blue:100,red:100},'green').payout/300,.97,'unchanged 97% theoretical return with hidden unbiased chairs');
 console.log('PASS Princess: 22,100 exhaustive hands; 5,000 unbiased deals; no cards before betting closes; reveal after close; fixed 3x/3% = 97% theoretical RTP; exact settlement/fee; Pro unchanged.');
}
verifyTeenPattiChairRules();
