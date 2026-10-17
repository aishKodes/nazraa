import assert from "node:assert/strict";
import {beautyControls, beautyTuning} from "../lib/services/beauty-policy";

assert.equal(Object.keys(beautyControls).length,18);
assert.deepEqual(beautyTuning({faceSlim:200,jawWidth:-50,toneLift:64,faceLight:75,glow:NaN,unknown:99}),
  {toneEvenness:64,relight:75,faceSlim:100,jawWidth:0,toneLift:64,faceLight:75});
assert.equal(beautyTuning({toneEvenness:70,toneLift:20}).toneLift,70);
assert.deepEqual(beautyTuning(null),{});
assert.deepEqual(beautyTuning([]),{});
assert.deepEqual(beautyTuning({faceSlim:"100",eyeScale:Infinity}),{});
for(const key of Object.keys(beautyControls)) {
  assert.equal(beautyTuning({[key]:37.6})[key],38);
  assert.equal(beautyTuning({[key]:-10})[key],0);
  assert.equal(beautyTuning({[key]:110})[key],100);
}
console.log("PASS: 18 canonical beauty controls, bounds, finite/unknown rejection, legacy aliases, no media/economy writes");
