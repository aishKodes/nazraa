import {createHash,randomBytes} from 'node:crypto';
import {evaluateChairHand,teenPattiChairs,teenPattiCard,chairSettlement} from './teen-patti';

export const princessQuoteRules='PRINCESS_PUBLIC_CARD_QUOTE_V3';
export const princessFixedQuoteRules='PRINCESS_PUBLIC_CARD_FIXED_3X_V4';
export function isPrincessQuotedRules(value:unknown){
  return value===princessQuoteRules || value===princessFixedQuoteRules;
}
const PAIRS=49*48/2;
export const conditionalDeals=PAIRS*(47*46/2)*(45*44/2);
let handRanks:Int32Array|undefined;
function rankTable(){
  if(handRanks)return handRanks;
  const table=new Int32Array(52*52*52);
  for(let a=0;a<50;a++)for(let b=a+1;b<51;b++)for(let c=b+1;c<52;c++){
    const hand=evaluateChairHand([a,b,c]);
    let score=hand.category;
    for(let n=0;n<3;n++)score=score*16+(hand.points[n]??0);
    table[a*2704+b*52+c]=score*4+hand.highestCardSuit;
  }
  return handRanks=table;
}
function score(table:Int32Array,a:number,b:number,c:number){
  if(a>b)[a,b]=[b,a];if(b>c)[b,c]=[c,b];if(a>b)[a,b]=[b,a];
  return table[a*2704+b*52+c];
}
const cached=new Map<string,readonly number[]>();
/** Exact conditional probabilities over ALL C(49,2)×C(47,2)×C(45,2) private completions,
 * not Monte Carlo odds and never a function of bets/identity/wallet. For each
 * candidate hand, count weaker opponent pairs using card-incidence exclusion;
 * this avoids enumerating a billion full deals on the request path. */
export function exactPrincessPreviewWins(publicCards:readonly number[]):readonly number[]{
  if(publicCards.length!==3 || new Set(publicCards).size!==3)throw new Error('Invalid Princess preview.');
  publicCards.forEach(teenPattiCard);
  const key=publicCards.join(',');const prior=cached.get(key);if(prior)return prior;
  const remaining=Array.from({length:52},(_,i)=>i).filter(card=>!publicCards.includes(card));
  const first=new Int8Array(PAIRS),second=new Int8Array(PAIRS);
  const ranks=[new Int32Array(PAIRS),new Int32Array(PAIRS),new Int32Array(PAIRS)];
  const table=rankTable();let index=0;
  for(let a=0;a<49;a++)for(let b=a+1;b<49;b++){
    first[index]=a;second[index]=b;
    for(let chair=0;chair<3;chair++)ranks[chair][index]=score(table,publicCards[chair],remaining[a],remaining[b]);
    index++;
  }
  const wins=[0,0,0];
  for(let chair=0;chair<3;chair++){
    const b=(chair+1)%3,c=(chair+2)%3;
    const incidence=new Int32Array(49);
    for(let own=0;own<PAIRS;own++){
      const x=first[own],y=second[own],value=ranks[chair][own];
      incidence.fill(0);let weaker=0;
      for(let pair=0;pair<PAIRS;pair++){
        const i=first[pair],j=second[pair];
        if(i===x||i===y||j===x||j===y||ranks[c][pair]>=value)continue;
        weaker++;incidence[i]++;incidence[j]++;
      }
      for(let pair=0;pair<PAIRS;pair++){
        const i=first[pair],j=second[pair];
        if(i===x||i===y||j===x||j===y||ranks[b][pair]>=value)continue;
        wins[chair]+=weaker-incidence[i]-incidence[j]+(ranks[c][pair]<value?1:0);
      }
    }
  }
  if(wins.reduce((a,b)=>a+b,0)!==conditionalDeals)throw new Error('Princess conditional deal invariant failed.');
  if(cached.size>=256)cached.delete(cached.keys().next().value!);
  const immutable=Object.freeze(wins);cached.set(key,immutable);return immutable;
}
export type PrincessQuote={rulesVersion:string;publicCards:number[];winCompletions:number[];
  totalCompletions:number;grossMultiplierPpm:number[];targetRtpPpm:number;feeBps:number;maximumMultiplier:number};
export function princessQuote(publicCards:readonly number[],targetRtp=.97,maximumMultiplier=30):PrincessQuote {
  if(!Number.isFinite(targetRtp)||targetRtp<.5||targetRtp>1)throw new Error('Invalid Princess RTP.');
  if(!Number.isFinite(maximumMultiplier)||maximumMultiplier<1||maximumMultiplier>1000)throw new Error('Invalid Princess payout cap.');
  const wins=exactPrincessPreviewWins(publicCards),targetRtpPpm=Math.floor(targetRtp*1_000_000),feeBps=300;
  const grossMultiplierPpm=wins.map(count=>Math.min(Math.floor(maximumMultiplier*1_000_000),
    Number(BigInt(targetRtpPpm)*BigInt(conditionalDeals)*10_000n/(BigInt(count)*BigInt(10_000-feeBps)))));
  return {rulesVersion:princessQuoteRules,publicCards:[...publicCards],winCompletions:[...wins],
    totalCompletions:conditionalDeals,grossMultiplierPpm,targetRtpPpm,feeBps,maximumMultiplier};
}
/** Owner-fixed gross return, not conditional-odds pricing. Preserve the actual
 * public card, fair deck and fee. Never rewrite V3's accepted round snapshots. */
export function princessFixedQuote(publicCards:readonly number[]):PrincessQuote {
  if(publicCards.length!==3 || new Set(publicCards).size!==3)throw new Error('Invalid Princess preview.');
  publicCards.forEach(teenPattiCard);
  return {rulesVersion:princessFixedQuoteRules,publicCards:[...publicCards],winCompletions:[],
    totalCompletions:0,grossMultiplierPpm:[3_000_000,3_000_000,3_000_000],
    targetRtpPpm:970_000,feeBps:300,maximumMultiplier:3};
}
export function commitPrincessQuote(hands:unknown,quote:PrincessQuote,nonce=randomBytes(32).toString('hex')){
  // MySQL JSON reorders object keys. Canonicalize recursively so the public
  // proof survives durable round trips without changing a single value.
  function canonical(value:unknown):unknown {
    if(Array.isArray(value))return value.map(canonical);
    if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
    return value;
  }
  const commitment=createHash('sha256').update(JSON.stringify(canonical({rulesVersion:quote.rulesVersion,hands,quote,nonce}))).digest('hex');
  return {commitment,nonce};
}
export function quotedPrincessSettlement(bets:Record<string,number>,winner:string,quote:PrincessQuote){
  const index=teenPattiChairs.indexOf(winner as typeof teenPattiChairs[number]);
  if(index<0)throw new Error('Invalid Princess winner.');
  const amount=bets[winner]??0;
  const grossPayout=Number(BigInt(amount)*BigInt(quote.grossMultiplierPpm[index])/1_000_000n);
  const serviceFee=Number((BigInt(grossPayout)*BigInt(quote.feeBps)+9999n)/10_000n);
  if(!Number.isSafeInteger(grossPayout)||!Number.isSafeInteger(serviceFee))throw new Error('Princess payout is too large.');
  return {grossPayout,serviceFee,payout:grossPayout-serviceFee};
}
export function princessSettlement(bets:Record<string,number>,outcome:Record<string,unknown>){
 const validated=chairSettlement(bets,String(outcome.winner));
 if(!isPrincessQuotedRules(outcome.rulesVersion))return validated;
 const quote=outcome.pricing as PrincessQuote;
 if(!quote || quote.rulesVersion!==outcome.rulesVersion || quote.grossMultiplierPpm?.length!==3 ||
   quote.grossMultiplierPpm.some(v=>!Number.isSafeInteger(v)||v<1||v>1_000_000_000) || quote.feeBps!==300 ||
   (outcome.rulesVersion===princessFixedQuoteRules && (quote.maximumMultiplier!==3 || quote.grossMultiplierPpm.some(v=>v!==3_000_000))) ||
   typeof outcome.nonce!=='string' || commitPrincessQuote(outcome.hands,quote,outcome.nonce).commitment!==outcome.commitment)
   throw new Error('The Princess round commitment is invalid.');
 return {wager:validated.wager,...quotedPrincessSettlement(bets,String(outcome.winner),quote)};
}
