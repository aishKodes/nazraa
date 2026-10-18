export const beautyControls = {
  smoothing: 82, fairness: 72, toneEvenness: 76, blemishReduction: 88,
  underEye: 80, lipTint: 52, blush: 22, detailSharpen: 42, glow: 58, relight: 76,
  faceSlim: 58, lowerFaceWidth: 35, jawWidth: 42, cheekWidth: 38, eyeScale: 65,
  eyeOpening: 35, noseWidth: 25, chinAdjustment: 25,
  // V5-only shader calibration. Existing APKs ignore these additional keys.
  // Exposure and WB are GPU grade offsets (50 neutral), not sensor promises.
  cameraExposure:50, whiteBalanceBias:50,
  temporalDenoise:65, chromaDenoise:65, motionReject:75,
  smoothLow:90, smoothMid:95, detailPreserve:65,
  fairnessLuma:100, fairnessGamma:95, fairnessShadowLift:90,
  fairnessMidLift:90, fairnessHighlightRollOff:80,
  skinWarmth:55, skinPink:55, skinSaturation:60,
  lipPink:75, lipSaturation:75, lipGloss:60,
  ringLight:90, fillLight:85, lightDirection:50, lightSoftness:75,
  faceExposure:75, shadowLift:80, specular:55, specularSize:55,
  specularSoftness:75, skinGlow:65, bloom:30, eyeBrightness:50,
  eyeSharpness:55, finalExposure:50, finalContrast:55,
  finalSaturation:55, finalSharpen:35, LUTStrength:70,
  semanticMask:65,
} as const;
export const beautyPublicMappingDefaults = {
  beautyExponent: 1.10, fairnessExponent: 1.45, lightExponent:1.15, lipsExponent: 1.15, faceExponent: 1.65,
  fairnessTone: .45, fairnessUnderEye: .45, beautyRelight: .35,
  fairnessRelight: .75, beautyBlush: .40, fairnessBlush: .60,
} as const;
/** Numbers only, no executable curves. Endpoints remain 0 and 1 in clients. */
export function beautyPublicMapping(value: unknown): Record<string, number> {
  const result: Record<string,number> = {...beautyPublicMappingDefaults};
  if(!value || typeof value!=="object" || Array.isArray(value)) return result;
  const source=value as Record<string,unknown>;
  for(const key of Object.keys(result)) {
    const raw=source[key];
    if(typeof raw==="number" && Number.isFinite(raw)) result[key]=Math.max(key.endsWith("Exponent")?.5:0,Math.min(key.endsWith("Exponent")?3:1,raw));
  }
  return result;
}
/** Allowlist finite, bounded controls; never transmit unknown config/HTML. */
export function beautyTuning(value: unknown): Record<string,number> {
  const result: Record<string,number> = {};
  if(!value || typeof value!=="object" || Array.isArray(value)) return result;
  const source=value as Record<string,unknown>;
  for(const key of Object.keys(beautyControls)) {
    const raw=source[key] ?? source[key==="toneEvenness"?"toneLift":key==="relight"?"faceLight":key];
    if(typeof raw==="number" && Number.isFinite(raw)) result[key]=Math.round(Math.max(0,Math.min(100,raw)));
  }
  // Prior APKs consume these names; preserve mixed-version compatibility.
  if(result.toneEvenness!==undefined) result.toneLift=result.toneEvenness;
  if(result.relight!==undefined) result.faceLight=result.relight;
  return result;
}
