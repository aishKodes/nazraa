import {randomInt} from 'node:crypto';

/** New game only. Never import Pro's Crown, lane odds or RTP evaluator. */
export const TEEN_PATTI_ID='teen_patti' as const;
export const teenPattiChairs=['green','blue','red'] as const;
export const teenPattiRulesVersion='CHAIRS_3X_FEE3_HIDDEN_V2';
export type TeenPattiChair=typeof teenPattiChairs[number];
export const teenPattiCategories=['High card','Pair','Flush','Straight','Flush Straight','Three of a kind'] as const;
// Card encoding: Diamonds, Clubs, Hearts, Spades; ranks 2 through Ace.
export function teenPattiCard(card:number){
 if(!Number.isInteger(card)||card<0||card>51)throw new Error('Invalid TeenPatti card.');
 return {rank:card%13+2,suit:Math.floor(card/13)};
}
export function evaluateChairHand(cards:readonly number[]){
 if(cards.length!==3||new Set(cards).size!==3)throw new Error('TeenPatti requires three unique cards.');
 const decoded=cards.map(teenPattiCard);
 const ranks=decoded.map(c=>c.rank).sort((a,b)=>b-a);
 const counts=new Map<number,number>();for(const r of ranks)counts.set(r,(counts.get(r)||0)+1);
 const flush=new Set(decoded.map(c=>c.suit)).size===1;
 const run=counts.size!==3?0:ranks.join(',')==='14,13,12'?15:ranks.join(',')==='14,3,2'?14:
  ranks[0]-1===ranks[1]&&ranks[1]-1===ranks[2]?ranks[0]:0;
 const pair=[...counts].find(([,n])=>n===2)?.[0];
 const category=counts.size===1?5:flush&&run?4:run?3:flush?2:pair!=null?1:0;
 const points=category===5?[ranks[0]]:category===4||category===3?[run]:category===1?
  [pair!,[...counts].find(([,n])=>n===1)![0]]:ranks;
 // Only after every point/kicker ties, compare the highest card's suit.
 const highestCardSuit=Math.max(...decoded.filter(c=>c.rank===ranks[0]).map(c=>c.suit));
 return {category,label:teenPattiCategories[category],points,highestCardSuit};
}
export function compareChairHands(a:readonly number[],b:readonly number[]){
 const left=evaluateChairHand(a),right=evaluateChairHand(b);
 if(left.category!==right.category)return left.category-right.category;
 for(let i=0;i<left.points.length;i++)if(left.points[i]!==right.points[i])return left.points[i]-right.points[i];
 return left.highestCardSuit-right.highestCardSuit;
}
export function chairOutcomeFromDeck(deck:readonly number[]){
 if(deck.length!==52||new Set(deck).size!==52)throw new Error('TeenPatti requires one standard 52-card deck.');
 deck.forEach(teenPattiCard);
 const hands=teenPattiChairs.map((chair,index)=>{
  const cards=[deck[index],deck[index+3],deck[index+6]];
  return {chair,cards,...evaluateChairHand(cards)};
 });
 let winner=0;for(let i=1;i<3;i++)if(compareChairHands(hands[i].cards,hands[winner].cards)>0)winner=i;
 return {rulesVersion:teenPattiRulesVersion,hands,winner:teenPattiChairs[winner],winningItemId:teenPattiChairs[winner],
  multiplier:3,serviceFeePercent:3,selectionModel:'UNBIASED_SINGLE_DECK',oddsFinalized:true};
}
export function dealChairRound(){
 const deck=Array.from({length:52},(_,i)=>i);
 for(let i=51;i>0;i--){const j=randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
 return chairOutcomeFromDeck(deck);
}
/** No dealt card may be public while a wager can still be accepted. A real
 * face-up card makes the 3x/3% paytable exploitable even with an unbiased deal.
 * Omit cards (not an empty array): old APKs index any non-null card array. */
export function chairPreview(outcome:Record<string,unknown>,bettingClosed=false):{cards?:number[]}{
 if(!bettingClosed)return {};
 const hands=outcome.hands as {cards:number[]}[];
 if(!Array.isArray(hands)||hands.length!==3)throw new Error('TeenPatti round is unavailable.');
 return {cards:hands.map(hand=>hand.cards[0])};
}
export function chairSettlement(bets:Record<string,number>,winner:string){
 if(!teenPattiChairs.includes(winner as TeenPattiChair))throw new Error('Invalid TeenPatti result.');
 if(Object.keys(bets).some(k=>!teenPattiChairs.includes(k as TeenPattiChair)))throw new Error('Choose a valid TeenPatti chair.');
 let wager=0;for(const chair of teenPattiChairs){const amount=bets[chair]??0;
  if(!Number.isSafeInteger(amount)||amount<0||amount%100!==0)throw new Error('Choose a valid TeenPatti chip amount.');wager+=amount;
 }
 if(!Number.isSafeInteger(wager))throw new Error('TeenPatti amount is too large.');
 const grossPayout=(bets[winner]??0)*3;
 if(!Number.isSafeInteger(grossPayout))throw new Error('TeenPatti payout is too large.');
 const serviceFee=grossPayout/100*3;
 return {wager,grossPayout,serviceFee,payout:grossPayout-serviceFee};
}
