/** Pure visual metadata. Prices are recorded for audit only, never imported. */
export type GiftVisualPackEntry={sourceId:string;name:string;displayClass:'NORMAL'|'PREMIUM'|'SUPER_PREMIUM'|'FULL_CINEMATIC';animationType:string;durationMs:number;priority:number;displayRegion:string;finishingStyle:string;version:string;hasEmbeddedSound?:boolean;preparedVideo?:{width:number;height:number};thumbnail:{file:string;sha256:string;bytes:number}|null;animationAsset:{file:string;sha256:string;bytes:number}|null};
export function visualPackConfig(g:GiftVisualPackEntry){
 if(!['NORMAL','PREMIUM','SUPER_PREMIUM','FULL_CINEMATIC'].includes(g.displayClass)||!['GOLD','JEWEL','SWEEP','GLITTER','BLOOM','CROWN','DIAMOND','EMBER'].includes(g.finishingStyle)||!Number.isInteger(g.durationMs)||g.durationMs<250||g.durationMs>8000)throw Error('Invalid visual pack metadata.');
 return {...(g.preparedVideo?{width:g.preparedVideo.width,height:g.preparedVideo.height}:{}),displayClass:g.displayClass,displayRegion:g.displayClass==='NORMAL'?'LOWER_VIDEO':'USABLE_VIDEO',finishingStyle:g.finishingStyle,presentationTier:g.displayClass==='NORMAL'?'MEDIUM':g.displayClass==='PREMIUM'?'PREMIUM':'ULTRA',displayMode:'FULL',position:'BOTTOM',durationMs:g.durationMs,loop:false,priority:Math.max(0,Math.min(1000,g.priority)),gameBehavior:'COMPACT',modalBehavior:'COMPACT',visualPackVersion:g.version,visualPackSourceId:g.sourceId,hasEmbeddedSound:g.hasEmbeddedSound===true,minimumAppVersion:'2.5.11'};
}
export function matchGiftVisual<T extends {id:string;gift_key:string;name:string}>(g:GiftVisualPackEntry,rows:T[]):T|null{
 const exact=rows.filter(r=>r.id===g.sourceId||r.gift_key===g.sourceId);if(exact.length===1)return exact[0];if(exact.length>1)return null;
 const normalized=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');const names=rows.filter(r=>normalized(r.name)===normalized(g.name));return names.length===1?names[0]:null;
}
