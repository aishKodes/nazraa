import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {beautyControls,beautyTuning,beautyPublicMapping} from '../lib/services/beauty-policy';
const mobileRoot=process.env.NAZRAA_MOBILE_ROOT ?? path.resolve('..','nazra2');
const cases=JSON.parse(fs.readFileSync(path.join(mobileRoot,'android/app/src/androidTest/assets/beauty-v5-cases.json'),'utf8'));
for(const [key,value] of Object.entries(cases[0].v5))assert.equal(beautyControls[key as keyof typeof beautyControls],value,key);
assert.deepEqual(beautyTuning({cameraExposure:-10,LUTStrength:400,semanticMask:65,bloom:NaN,shader:'untrusted',unknown:9}),{cameraExposure:0,LUTStrength:100,semanticMask:65});
assert.equal(beautyPublicMapping({lightExponent:99}).lightExponent,3);
assert.equal(beautyPublicMapping({lightExponent:NaN}).lightExponent,1.15);
// Existing values/aliases remain identical for older deployed APKs.
assert.equal(beautyTuning({faceLight:42}).relight,42);
assert.equal(beautyTuning({toneLift:35}).toneEvenness,35);
const action=fs.readFileSync('app/media-product-actions.ts','utf8');
assert.match(action,/scope.account.role!=="MASTER"/);
assert.match(action,/BEAUTY_TUNING_UPDATE/);
assert.match(action,/mergedTuning=\{\.\.\.beautyTuning\(current.naturalBeautyTuning\),\.\.\.tuning\}/);
console.log('Beauty V5: Dart/server calibration parity, finite bounds, old aliases, Master authorization/audit and omitted-field preservation PASS.');
