import assert from "node:assert/strict";
import {
  calculatePkStreakSettlement,
  pkStreakMilestone,
} from "../lib/policy/pk-streak-policy";

function settle(currentStreak: number, receivedCoins: number, result: "WIN" | "LOSS" | "DRAW" = "WIN") {
  return calculatePkStreakSettlement({ currentStreak, receivedCoins, result });
}

// A: visual win below threshold never advances or erases progress.
assert.deepEqual(settle(2, 4999), {
  qualifying: false, streakAfter: 2, milestoneWins: null, bonusCoins: 0, milestoneTotalCoins: 0,
});
// B/C: exact threshold qualifies and the third qualifying win pays 10k.
assert.equal(settle(0, 5000).streakAfter, 1);
assert.deepEqual(settle(2, 5000), {
  qualifying: true, streakAfter: 3, milestoneWins: 3, bonusCoins: 10000, milestoneTotalCoins: 10000,
});
// D: a complete seven-win run is 10k at 3 plus only 10k at 7.
assert.equal(settle(3, 5000).streakAfter, 4);
assert.equal(settle(4, 6000).streakAfter, 5);
assert.equal(settle(5, 10000).streakAfter, 6);
assert.deepEqual(settle(6, 5000), {
  qualifying: true, streakAfter: 0, milestoneWins: 7, bonusCoins: 10000, milestoneTotalCoins: 20000,
});
assert.equal(10000 + settle(6, 5000).bonusCoins, 20000);
// E/F: manual cancel and network interruption do not invoke settlement; the
// retained state is represented by a non-qualifying non-loss outcome here.
assert.equal(settle(2, 0, "DRAW").streakAfter, 2);
// G: only an actual completed loss resets.
assert.equal(settle(2, 0, "LOSS").streakAfter, 0);
// H: duplicate callback policy is deterministic; DB uniqueness supplies the
// durable second half of idempotency (PK_STREAK:<cycle>:<milestone>).
assert.deepEqual(settle(2, 5000), settle(2, 5000));
// I: streak state is Host-owned, so no opponent input can affect this policy.
assert.equal(settle(1, 5000).streakAfter, 2);
assert.deepEqual(pkStreakMilestone(2), { wins: 3, totalCoins: 10000, awardCoins: 10000 });
assert.deepEqual(pkStreakMilestone(3), { wins: 7, totalCoins: 20000, awardCoins: 10000 });

console.log("PK streak policy: 9 cases passed");
