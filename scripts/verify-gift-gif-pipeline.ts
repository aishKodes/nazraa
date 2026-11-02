import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='server-only'?'next/dist/compiled/server-only/empty.js':specifier,context)}});
async function main(){
 const {default:sharp}=await import('sharp');const {preparePublicEffect}=await import('../lib/security/public-images');
 const pixels=Buffer.alloc(32*64*4,0);for(let i=0;i<pixels.length;i+=4){pixels[i]=220;pixels[i+3]=i<32*32*4?255:100;}
 const gif=await sharp(pixels,{raw:{width:32,height:64,channels:4,pageHeight:32}}).gif({delay:[100,150],loop:0}).toBuffer();
 const result=await preparePublicEffect(new File([gif],'transparent.gif',{type:'image/gif'}));
 const out=await sharp(result.data,{animated:true}).metadata();
 assert.equal(result.assetType,'ANIMATED_WEBP');assert.equal(out.pages,2);assert.equal(out.hasAlpha,true);assert.equal(result.durationMs,250);assert.equal(result.width,32);assert.equal(result.height,32);
 await assert.rejects(()=>preparePublicEffect(new File([Buffer.from('GIF89a_bad')],'bad.gif',{type:'image/gif'})));
 await assert.rejects(()=>preparePublicEffect(new File([gif],'fake.gif',{type:'video/mp4'})));
 console.log('GIF_PIPELINE_PASS: two frames, alpha, dimensions, timing preserved; malformed/MIME mismatch rejected');
}
main().catch(e=>{console.error(e);process.exitCode=1});
