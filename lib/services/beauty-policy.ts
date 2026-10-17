export const beautyControls = {
  smoothing: 82, fairness: 72, toneEvenness: 76, blemishReduction: 88,
  underEye: 80, lipTint: 52, blush: 22, detailSharpen: 42, glow: 58, relight: 76,
  faceSlim: 58, lowerFaceWidth: 35, jawWidth: 42, cheekWidth: 38, eyeScale: 65,
  eyeOpening: 35, noseWidth: 25, chinAdjustment: 25,
} as const;
export const beautyPublicMappingDefaults = {
  beautyExponent: 1.10, fairnessExponent: 1.45, lipsExponent: 1.15, faceExponent: 1.65,
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
