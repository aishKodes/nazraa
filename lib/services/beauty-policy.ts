export const beautyControls = {
  smoothing: 62, fairness: 46, toneLift: 52, blemishReduction: 76,
  underEye: 52, lipTint: 22, blush: 18, detailSharpen: 32, glow: 48, faceLight: 60,
} as const;
/** Allowlist finite, bounded controls; never transmit unknown config/HTML. */
export function beautyTuning(value: unknown): Record<string,number> {
  const result: Record<string,number> = {};
  if(!value || typeof value!=="object" || Array.isArray(value)) return result;
  for(const key of Object.keys(beautyControls)) {
    const raw=(value as Record<string,unknown>)[key];
    if(typeof raw==="number" && Number.isFinite(raw)) result[key]=Math.round(Math.max(0,Math.min(100,raw)));
  }
  return result;
}
