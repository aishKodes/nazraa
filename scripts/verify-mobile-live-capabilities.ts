import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
import type {MobileIdentity,MobileRole} from '../lib/auth/mobile-session';
async function main(){
const {mobileCan}=await import('../lib/auth/mobile-session');
const {LiveAccessPolicyService}=await import('../lib/services/live-access-policy');
const {liveStartReason}=await import('../lib/services/live-start-reason');
const roles:MobileRole[]=['NORMAL_USER','HOST','COIN_SELLER','AGENCY_OWNER','AGENCY_MANAGER','ADMIN','SUPER_ADMIN','MASTER','MONITORING_CS'];
const identity=(role:MobileRole):MobileIdentity=>({userId:'qa',publicId:'12000001',externalUserId:'qa',fullName:'QA',role,accountStatus:'ACTIVE',faceVerificationStatus:'VERIFIED',agencyAccountId:'qa-agency',agencyFaceLiveAuthorized:true,superAdminFaceLiveAuthorized:true,hostAccessOverride:false,hostProfileStatus:null,liveRestricted:false,liveRestrictedUntil:null,liveRestrictionReason:null,temporaryLiveRestricted:false,temporaryLiveRestrictedUntil:null,temporaryLiveRestrictionReason:null,hostingSuspended:false,hostingSuspendedUntil:null,hostingSuspensionReason:null});
for(const role of roles){const i=identity(role),p=LiveAccessPolicyService.for(i);const party=mobileCan(i,'rooms.create.party')&&p.party.allowed,face=mobileCan(i,'rooms.create.live')&&p.face.allowed;assert.equal(party,!['NORMAL_USER','MONITORING_CS'].includes(role));assert.equal(face,!['NORMAL_USER','MONITORING_CS','AGENCY_MANAGER'].includes(role));console.log(role,'Party:',party,'Face:',face);}
const seller=identity('COIN_SELLER');assert.equal(seller.role,'COIN_SELLER');assert(!mobileCan(seller,'withdrawals.create'));assert(!mobileCan(seller,'moderation.read'));
assert(!LiveAccessPolicyService.for({...seller,faceVerificationStatus:'PENDING'}).face.allowed);
assert(!LiveAccessPolicyService.for({...seller,agencyAccountId:null}).face.allowed);
assert(!LiveAccessPolicyService.for({...seller,hostingSuspended:true}).party.allowed);
assert(!LiveAccessPolicyService.for({...seller,temporaryLiveRestricted:true}).face.allowed);
for(const [message,code] of [['Your role cannot start this room type.','ROLE_NOT_ALLOWED'],['Hosting is suspended.','ACCOUNT_SUSPENDED'],['Join an approved Agency to unlock Face Live.','AGENCY_REQUIRED'],['Verified Face Live access is required.','VERIFICATION_REQUIRED'],['The room limit has been reached.','ROOM_LIMIT_REACHED']])assert.equal(liveStartReason(new Error(message)),code);
console.log('PASS role identity preserved, restricted sellers denied, no added financial/moderation authority, deterministic sanitized reasons.');

}
main().catch(e=>{console.error(e);process.exitCode=1});
