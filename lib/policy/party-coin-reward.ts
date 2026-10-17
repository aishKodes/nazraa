import { randomInt } from 'node:crypto';
export const partyRewardAmounts = [20, 30, 50, 100] as const;
export const partyRewardIntervalMs = 300_000;
export const partyRewardDailyLimit = 5;
export function rewardWeights(value: unknown): number[] {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const weights = partyRewardAmounts.map(amount => {
    const n = Number(v[amount]);
    return Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000 ? n : 1;
  });
  return weights.some(n => n > 0) ? weights : [1, 1, 1, 1];
}
export function pickPartyReward(weights: number[], random = randomInt): number {
  let ticket = random(weights.reduce((sum, n) => sum + n, 0));
  for (let i = 0; i < weights.length; i++) {
    if (ticket < weights[i]) return partyRewardAmounts[i];
    ticket -= weights[i];
  }
  throw new Error('Invalid reward distribution.');
}
export function partyRewardState(milliseconds: number, claims: number) {
  const seconds = Math.floor(milliseconds / 1000);
  const ready = claims < 5 && seconds >= (claims + 1) * 300;
  return {eligibleSeconds: seconds, claimsCompleted: claims, intervalIndex: Math.min(5, claims + 1),
    ready, phase: claims >= 5 ? 'DAILY_COMPLETE' : ready ? 'READY' : seconds > 0 ? 'PROGRESS' : 'IDLE',
    remainingSeconds: claims >= 5 ? 0 : Math.max(0, (claims + 1) * 300 - seconds),
    progress: claims >= 5 ? 1 : Math.max(0, Math.min(1, (seconds - claims * 300) / 300))};
}
