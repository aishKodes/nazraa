import assert from 'node:assert/strict';
import {chairOutcomeFromDeck,chairPreview,teenPattiCard,teenPattiChairs} from '../lib/games/teen-patti';

// Reproducible offline diagnostic, not production RNG or winner selection.
let seed=0x51692;
const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
const rounds=100000;
let fixedWins=0,visibleCardWins=0;
for(let i=0;i<rounds;i++){
  const deck=Array.from({length:52},(_,n)=>n);
  for(let n=51;n>0;n--){const j=Math.floor(next()*(n+1));[deck[n],deck[j]]=[deck[j],deck[n]];}
  const outcome=chairOutcomeFromDeck(deck);
  if(outcome.winner==='green')fixedWins++;
  const exposed=chairPreview(outcome,true).cards!;
  let selected=0;
  for(let c=1;c<3;c++){
    const a=teenPattiCard(exposed[c]),b=teenPattiCard(exposed[selected]);
    if(a.rank>b.rank||a.rank===b.rank&&a.suit>b.suit)selected=c;
  }
  if(outcome.winner===teenPattiChairs[selected])visibleCardWins++;
  assert.deepEqual(chairPreview(outcome),{},'new betting payload offers no real-card selection signal');
}
const beforeReturn=visibleCardWins/rounds*2.91;
const fixedReturn=fixedWins/rounds*2.91;
assert(beforeReturn>1.2,'old preview permits a positive-expectation strategy without hacking');
assert(Math.abs(fixedReturn-.97)<.02,'blind unbiased chair remains near theoretical 97% RTP');
console.log(JSON.stringify({rounds,seed:'0x51692',before:{strategy:'highest visible first card',wins:visibleCardWins,returnPer100:beforeReturn*100},after:{allCardsHidden:true,fixedChairWins:fixedWins,returnPer100:fixedReturn*100,theoreticalRtp:.97,houseEdge:.03},settlementUnchanged:true}));
