/** No device timestamps. Both boundary and quota are shared by every caller. */
export const AUTO_RESUME_SECONDS = 180;
export const AUTO_RESUME_DAILY_LIMIT = 5;
export function autoResumeDecision(input: {
  interruptedAt: Date; serverNow: Date; qualifying: boolean; successfulToday: number;
}) {
  const elapsed = +input.serverNow - +input.interruptedAt;
  if (elapsed < 0) return 'STALE' as const;
  if (elapsed > AUTO_RESUME_SECONDS * 1000) return 'EXPIRED' as const;
  if (!input.qualifying) return 'INTERNAL_RECOVERY' as const;
  return input.successfulToday < AUTO_RESUME_DAILY_LIMIT ? 'RESUMED' as const : 'QUOTA_EXHAUSTED' as const;
}
