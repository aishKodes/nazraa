import {randomInt} from 'node:crypto';
export type LuckyTier={id:string;rewardType:'MULTIPLIER';multiplierBps:number;weight:number;enabled:boolean};
export const luckyDefaults={enabled:false,winBps:2500,receiverBps:2000,companyBps:8000,minimumGrossCoins:1,version:1,tiers:[
  [1000,40000],[2000,30000],[5000,20000],[10000,7000],[20000,2000],[50000,600],[100000,200],[120000,80],[130000,50],[180000,30],[200000,30],[250000,10],
].map(([multiplierBps,weight])=>({id:'tier_'+multiplierBps,rewardType:'MULTIPLIER' as const,multiplierBps,weight,enabled:true}))};
export type LuckyPolicy=typeof luckyDefaults;
export function luckyPolicy(raw:unknown):LuckyPolicy{
  const value=typeof raw==='string'?JSON.parse(raw):raw as Partial<LuckyPolicy>|null;
  const p={...luckyDefaults,...value};
  if(typeof p.enabled!=='boolean'||p.winBps!==2500||p.receiverBps!==2000||p.companyBps!==8000||p.minimumGrossCoins!==1||!Number.isSafeInteger(p.version)||p.version<1)throw Error('Lucky Gift configuration is unavailable.');
  if(!Array.isArray(p.tiers)||p.tiers.length<1||p.tiers.length>50)throw Error('Lucky Gift tiers are invalid.');
  const ids=new Set<string>();let sum=0;
  for(const t of p.tiers){if(!/^[a-z0-9_]{1,40}$/.test(t.id)||ids.has(t.id)||t.rewardType!=='MULTIPLIER'||!Number.isSafeInteger(t.multiplierBps)||t.multiplierBps<1000||t.multiplierBps>250000||!Number.isSafeInteger(t.weight)||t.weight<0||t.weight>100000000||typeof t.enabled!=='boolean')throw Error('Lucky Gift tiers are invalid.');ids.add(t.id);if(t.enabled)sum+=t.weight;}
  if(sum<1||sum>1000000000)throw Error('Lucky Gift weights are invalid.');
  return p;
}
/** The same Node crypto.randomInt CSPRNG used by the existing game engine.
 * No identity/balance/history enters the draw. Injection is for isolated tests. */
export function drawLucky(p:LuckyPolicy,gross:number,random:(max:number)=>number=randomInt){
  if(!p.enabled)throw Error('Lucky Gifts are not available yet.');
  if(!Number.isSafeInteger(gross)||gross<p.minimumGrossCoins||!Number.isSafeInteger(gross*25))throw Error('Choose a supported Lucky Gift amount (at least 1 Coin).');
  const hit=random(10000)<p.winBps;
  if(!hit)return {won:false,tierId:'loss',multiplierBps:0,payoutCoins:0};
  const tiers=p.tiers.filter(t=>t.enabled&&t.weight>0),total=tiers.reduce((n,t)=>n+t.weight,0);let ticket=random(total);
  const selected=tiers.find(t=>{ticket-=t.weight;return ticket<0;})!;
  return {won:true,tierId:selected.id,multiplierBps:selected.multiplierBps,payoutCoins:Number(BigInt(gross)*BigInt(selected.multiplierBps)/10000n)};
}
export function luckyExpectation(p:LuckyPolicy){
  const enabled=p.tiers.filter(t=>t.enabled&&t.weight>0),weight=enabled.reduce((n,t)=>n+t.weight,0);
  const payoutBps=p.winBps/10000*enabled.reduce((n,t)=>n+t.weight*t.multiplierBps,0)/weight;
  return {winPercent:25,payoutPercent:payoutBps/100,receiverPercent:20,companyAllocationPercent:80,expectedCompanyPercent:(8000-payoutBps)/100,maxMultiplier:Math.max(...enabled.map(t=>t.multiplierBps))/10000,jackpotProbability:0.25*enabled.filter(t=>t.multiplierBps===250000).reduce((n,t)=>n+t.weight,0)/weight};
}
