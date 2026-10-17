export const beautyControls = {
  smoothing: 82, fairness: 72, toneEvenness: 76, blemishReduction: 88,
  underEye: 80, lipTint: 52, blush: 22, detailSharpen: 42, glow: 58, relight: 76,
  faceSlim: 58, lowerFaceWidth: 35, jawWidth: 42, cheekWidth: 38, eyeScale: 65,
  eyeOpening: 35, noseWidth: 25, chinAdjustment: 25,
} as const;
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
