import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {Scope} from '@/types/platform';
import {preparePublicEffect} from '@/lib/security/public-images';
import * as catalog from '@/lib/db/repositories/catalog';
import {mobileEffectManifest} from '@/lib/db/repositories/mobile-effect-manifest';
import {GET as getAsset} from '@/app/api/v1/assets/gifts/[id]/route';

export async function verifyPagCatalog(master:Scope){
 const bytes=Buffer.from([80,65,71,1,0,0,0,0,0]);
 // Structural server validation; the real Apache-2 fixture and corrupt-file
 // native-parser checks run independently in Android instrumentation.
 const effect=await preparePublicEffect(new File([bytes],'qa.pag',{type:'application/octet-stream'}));
 assert.equal(effect.assetType,'PAG');
 await assert.rejects(preparePublicEffect(new File(['not pag'],'wrong.pag',{type:'application/octet-stream'})),/invalid/);
 await assert.rejects(preparePublicEffect(new File([new Uint8Array(12*1024*1024+1)],'huge.pag',{type:'application/octet-stream'})),/smaller/);
 await catalog.createGift({scope:master,key:'qa_pag_catalog',name:'QA PAG',category:'QA',catalogType:'VIRTUAL_GIFT',emoji:'⭐',coinPrice:1,validityDays:1,sortOrder:0,
  animation:effect,effectConfig:{durationMs:1500,loop:false,position:'CENTER',zIndex:0,soundVolume:0,priority:200,presentationTier:'PREMIUM',displayMode:'AUTO',gameBehavior:'COMPACT',modalBehavior:'COMPACT',minimumAppVersion:'2.0.0'}});
 const entry=(await mobileEffectManifest()).effects.find(e=>e.id==='qa_pag_catalog');
 assert.ok(entry);
 assert.equal(entry.assetConfig.assetType,'PAG');
 assert.equal(entry.assetConfig.minimumAppVersion,'2.4.93');
 assert.equal(entry.assetConfig.assetChecksum,createHash('sha256').update(bytes).digest('hex'));
 const url=String(entry.assetConfig.assetUrl),id=new URL(url).pathname.split('/').at(-1)!;
 const response=await getAsset(new Request(url),{params:Promise.resolve({id})});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('content-type'),'application/octet-stream');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.match(response.headers.get('cache-control')??'',/immutable/);
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 console.log('PASS PAG catalogue: bounded upload/type rejection, Master-owned immutable URL, SHA256/version/minimum APK, active public .pag delivery with nosniff and immutable cache. Native corrupt-file safety tested separately.');
}
