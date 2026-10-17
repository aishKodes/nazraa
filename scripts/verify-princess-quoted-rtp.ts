import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {chairOutcomeFromDeck,teenPattiCard} from '../lib/games/teen-patti';
import {princessQuote,conditionalDeals,commitPrincessQuote,quotedPrincessSettlement} from '../lib/games/princess-preview-pricing';
async function main(){
const count=Number(process.env.NAZRAA_SIM_ROUNDS??1_000_000);
assert.ok(count>=10000);
const quoteTimes:number[]=[];
const fixtures=[];
for(let n=0;n<128;n++){
 const cards:number[]=[];while(cards.length<3){const c=randomInt(52);if(!cards.includes(c))cards.push(c);}
 const start=performance.now();const quote=princessQuote(cards);quoteTimes.push(performance.now()-start);
 assert.equal(quote.winCompletions.reduce((a,b)=>a+b,0),conditionalDeals);
 for(let c=0;c<3;c++)assert.ok(quote.winCompletions[c]/conditionalDeals*quote.grossMultiplierPpm[c]/1e6*.97<=.970001);
 fixtures.push({cards,quote});
}
// Conditional Monte Carlo: fresh CSPRNG private cards each round over 128
// uniformly sampled public states. Exact pricing enumerates every private
// completion for each state, including every information-based strategy.
let returns=0,squares=0,wins=0,theory=0;const distribution=new Map<number,number>();
for(let n=0;n<count;n++){
 const fixture=fixtures[randomInt(fixtures.length)];
 const remaining=Array.from({length:52},(_,i)=>i).filter(c=>!fixture.cards.includes(c));
 for(let i=0;i<6;i++){const j=i+randomInt(remaining.length-i);[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
 const deck=[...fixture.cards,...remaining];
 const outcome=chairOutcomeFromDeck(deck);
 const choice=fixture.cards.map((card,index)=>({rank:teenPattiCard(card).rank,index})).sort((a,b)=>b.rank-a.rank)[0].index;
 const amount=10_000,chair=['green','blue','red'][choice];
 const settled=quotedPrincessSettlement({[chair]:amount},outcome.winner,fixture.quote);
 const value=settled.payout/amount;
 returns+=value;squares+=value*value;if(value>0)wins++;
 distribution.set(settled.payout,(distribution.get(settled.payout)??0)+1);
 const prob=fixture.quote.winCompletions[choice]/conditionalDeals;
 const winPaid=quotedPrincessSettlement({[chair]:amount},chair,fixture.quote).payout/amount;
 theory+=prob*winPaid;
}
const mean=returns/count,variance=squares/count-mean*mean;
const report={rounds:count,publicStates:fixtures.length,model:'CSPRNG fresh private deals; exact public-card-conditional prices; highest-visible-card strategy',
 targetRtp:.97,theoreticalRtp:theory/count,observedRtp:mean,platformEdge:1-mean,
 variancePerUnit:variance,standardError:Math.sqrt(variance/count),wins,losses:count-wins,
 payoutDistribution:[...distribution].sort((a,b)=>a[0]-b[0]),
 quoteComputeMs:{p50:quoteTimes.sort((a,b)=>a-b)[64],p95:quoteTimes[121],max:quoteTimes.at(-1)}};
assert.ok(Math.abs(mean-theory/count)<6*report.standardError,'Observed conditional RTP must match exact theory');
const fixture=fixtures[0],a=commitPrincessQuote([],fixture.quote,'fixed');
assert.equal(a.commitment,commitPrincessQuote([],fixture.quote,'fixed').commitment);
assert.notEqual(a.commitment,commitPrincessQuote([],fixture.quote,'changed').commitment);
await mkdir('docs/qa/20261017',{recursive:true});
await writeFile('docs/qa/20261017/PRINCESS_QUOTED_RTP.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,payoutDistribution:`${distribution.size} actual payout amounts, full distribution in report`},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
