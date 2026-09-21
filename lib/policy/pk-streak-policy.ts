/**
 * The PK streak rule is deliberately independent from database and framework
 * code. It is used inside the settlement transaction and exercised directly
 * by release tests so a visual PK result can never accidentally become an
 * economy rule.
 */
export type PkResult = "WIN" | "LOSS" | "DRAW";

export function pkStreakMilestone(currentStreak: number) {
  const streak = Math.max(0, Math.min(7, Math.floor(currentStreak)));
  return streak < 3
    ? { wins: 3, totalCoins: 10000, awardCoins: 10000 }
    : { wins: 7, totalCoins: 20000, awardCoins: 10000 };
}

export function calculatePkStreakSettlement(input: {
  currentStreak: number;
  result: PkResult;
  receivedCoins: number;
}) {
  const prior = Math.max(0, Math.min(7, Math.floor(input.currentStreak)));
  if (input.result === "LOSS") {
    return {
      qualifying: false,
      streakAfter: 0,
      milestoneWins: null as number | null,
      bonusCoins: 0,
      milestoneTotalCoins: 0,
    };
  }

  // A visual win below 5,000 Coins and a draw are real PK outcomes but do
  // not advance or erase the Host's qualifying streak.
  const qualifying = input.result === "WIN" && input.receivedCoins >= 5000;
  if (!qualifying) {
    return {
      qualifying: false,
      streakAfter: prior,
      milestoneWins: null as number | null,
      bonusCoins: 0,
      milestoneTotalCoins: 0,
    };
  }

  // A completed seven-win cycle has already paid both milestones. Treat a
  // legacy stale value as a fresh run, never as a reason to reissue a bonus.
  const candidate = (prior >= 7 ? 0 : prior) + 1;
  if (candidate === 3) {
    return {
      qualifying: true,
      streakAfter: 3,
      milestoneWins: 3,
      bonusCoins: 10000,
      milestoneTotalCoins: 10000,
    };
  }
  if (candidate === 7) {
    // The 3-win reward was already 10,000. Credit precisely another 10,000
    // so the whole seven-win cycle pays 20,000, never 30,000.
    return {
      qualifying: true,
      streakAfter: 0,
      milestoneWins: 7,
      bonusCoins: 10000,
      milestoneTotalCoins: 20000,
    };
  }
  return {
    qualifying: true,
    streakAfter: candidate,
    milestoneWins: null as number | null,
    bonusCoins: 0,
    milestoneTotalCoins: 0,
  };
}
