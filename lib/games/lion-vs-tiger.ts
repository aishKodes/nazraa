import { randomInt } from 'node:crypto';

export const LION_VS_TIGER_ID = 'lion_vs_tiger' as const;
export const lionTigerAreas = ['tiger', 'draw', 'lion'] as const;
export type LionTigerArea = typeof lionTigerAreas[number];
export const lionTigerRules = Object.freeze({
  version: 'test 1.1.5', bettingSeconds: 15, maximumSelections: 3,
  // Reference paytable. The owner delegated the unspecified Draw meaning/odds.
  multipliers: { tiger: 2, draw: 30, lion: 2 } as const,
  weights: [15, 1, 15] as const,
  fee: 0,
});

/** No game-specific stake cap/denomination restriction. Available Coins and
 * exact integer representation remain mandatory wallet safety rules. */
export function validateLionTigerBets(input: Record<string, number>) {
  if (Object.keys(input).some(key => !lionTigerAreas.includes(key as LionTigerArea))) {
    throw new Error('Choose Tiger, Draw or Lion. You can select up to 3 outcomes.');
  }
  const bets = Object.fromEntries(lionTigerAreas.map(area => [area, input[area] ?? 0])) as Record<LionTigerArea, number>;
  let total = 0n;
  for (const amount of Object.values(bets)) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Enter a whole, non-negative Coin amount.');
    total += BigInt(amount);
  }
  if (Object.values(bets).filter(amount => amount > 0).length > 3) throw new Error('You can select up to 3 outcomes.');
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This amount cannot be represented safely.');
  return { bets, total: Number(total) };
}

/** Fixed, secure, bet-independent weights. Every area returns 30/31 gross
 * on average. No hidden RTP adjustment or fee is applied. */
export function dealLionTigerOutcome(draw: (upper: number) => number = randomInt) {
  const ticket = draw(31);
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= 31) throw new Error('Invalid outcome draw.');
  const winner: LionTigerArea = ticket < 15 ? 'tiger' : ticket === 15 ? 'draw' : 'lion';
  return { winner, multiplier: lionTigerRules.multipliers[winner],
    rulesVersion: lionTigerRules.version, oddsFinalized: true,
    selectionModel: 'BET_INDEPENDENT_FIXED_WEIGHTS' };
}

export function settleLionTiger(bets: Record<string, number>, winner: string) {
  if (!lionTigerAreas.includes(winner as LionTigerArea)) throw new Error('The Lion Vs Tiger result is invalid.');
  const checked = validateLionTigerBets(bets);
  const payout = BigInt(checked.bets[winner as LionTigerArea]) * BigInt(lionTigerRules.multipliers[winner as LionTigerArea]);
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This payout cannot be represented safely.');
  return { wager: checked.total, payout: Number(payout) };
}

/** Guard every potential result before debit, not an arbitrary stake cap. */
export function assertLionTigerWalletSafety(bets: Record<string, number>, balanceAfterBet: number) {
  if (!Number.isSafeInteger(balanceAfterBet) || balanceAfterBet < 0) throw new Error('Not enough Coins.');
  for (const winner of lionTigerAreas) {
    const { payout } = settleLionTiger(bets, winner);
    if (BigInt(balanceAfterBet) + BigInt(payout) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('This amount cannot be represented safely.');
    }
  }
}
