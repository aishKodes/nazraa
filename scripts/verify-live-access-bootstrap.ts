import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
registerHooks({resolve(specifier,context,next){return next(specifier==='server-only'?'next/dist/compiled/server-only/empty.js':specifier,context);}});
async function main(){
  const {LiveAccessPolicyService}=await import('@/lib/services/live-access-policy');
  for(const hostAccessOverride of [false,true]){
    for(const faceVerificationStatus of ['PENDING','REJECTED','VERIFIED']){
      const identity={hostAccessOverride,faceVerificationStatus,agencyAccountId:'qa-agency'} as MobileIdentity;
      const result=LiveAccessPolicyService.for(identity);
      assert.equal(result.face.allowed,faceVerificationStatus==='VERIFIED');
      assert.equal(result.video.allowed,result.face.allowed);
      assert.equal(result.party.allowed,true,'Face verification must not disable Party');
      assert.equal(LiveAccessPolicyService.for({...identity,temporaryLiveRestricted:true}).face.allowed,false);
      assert.equal(LiveAccessPolicyService.for({...identity,hostingSuspended:true}).party.allowed,false);
    }
  }
  console.log('PASS bootstrap: owner/normal pending, rejected, verified, restriction and Party authorization agree with canonical room creation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
