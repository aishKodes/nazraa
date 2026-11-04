import { randomInt } from 'node:crypto';
import { chairOutcomeFromDeck, teenPattiChairs } from './teen-patti';
import type { GameRuntimeConfig } from './game-config';

import {princessPrecommittedRules,princessPrecommittedProfile,princessSettlementCeiling,princessDefaultSinglePayout} from './princess-contract';
export {princessPrecommittedRules,princessPrecommittedProfile,princessSettlementCeiling,princessDefaultSinglePayout} from './princess-contract';

type PaytableConfig = Pick<GameRuntimeConfig,
  'targetRtp' | 'outcomeWeights' | 'princessServiceFeeBps' | 'maximumPayoutMultiplier'>;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
function fraction(a: number, b: number) {
  const d = gcd(a, b);
  return { numerator: a / d, denominator: b / d };
}

/** Fixed for the CONFIGURATION, not priced from cards, wagers or identity.
 * Each chair's exact net return is target / its published probability.
 * Settlement floors net once, then derives gross/fee using integer arithmetic.
 */
export function princessPrecommittedPaytable(c: PaytableConfig) {
  if (!Number.isFinite(c.maximumPayoutMultiplier) || c.maximumPayoutMultiplier < 1 || c.maximumPayoutMultiplier > 1000)
    throw Error('Choose a valid Princess return ceiling.');
  const weights = c.outcomeWeights ?? [1, 1, 1];
  if (weights.length !== 3 || weights.some(w => !Number.isSafeInteger(w) || w < 1 || w > 1_000_000))
    throw Error('Princess requires three positive, precommitted chair weights.');
  const rtpBps = Math.round(c.targetRtp * 10_000);
  if (!Number.isFinite(c.targetRtp) || rtpBps < 5000 || rtpBps > 9900 || Math.abs(c.targetRtp * 10_000 - rtpBps) > 1e-7)
    throw Error('Choose a Princess RTP between 50.00% and 99.00%, to two decimal places.');
  if (c.princessServiceFeeBps !== 500) throw Error('Princess keeps the published 5% service fee.');
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const areas = teenPattiChairs.map((chair, i) => {
    const net = fraction(rtpBps * totalWeight, 10_000 * weights[i]);
    const gross = fraction(rtpBps * totalWeight, 9500 * weights[i]);
    if (gross.numerator / gross.denominator > c.maximumPayoutMultiplier + 1e-10)
      throw Error('Choose chair weights and a return ceiling that can support the published RTP.');
    return { chair, weight: weights[i], probability: weights[i] / totalWeight,
      netNumerator: net.numerator, netDenominator: net.denominator,
      grossNumerator: gross.numerator, grossDenominator: gross.denominator };
  });
  return { rtpBps, totalWeight, weights: [...weights], areas };
}

export function princessNetReturn(amount: number, numerator: number, denominator: number, roundUp = false) {
  if (![amount, numerator, denominator].every(Number.isSafeInteger) || amount < 0 || numerator < 1 || denominator < 1)
    throw Error('The Princess paytable is unavailable.');
  const product = BigInt(amount) * BigInt(numerator), d = BigInt(denominator);
  const value = (product + (roundUp ? d - 1n : 0n)) / d;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('The Princess payout is too large.');
  return Number(value);
}

export function princessMultiplierPpm(numerator: number, denominator: number) {
  return Number(BigInt(numerator) * 1_000_000n / BigInt(denominator));
}

export function princessPrecommittedQuote(publicCards: readonly number[], config: GameRuntimeConfig) {
  const table = princessPrecommittedPaytable(config);
  if (publicCards.length !== 3 || new Set(publicCards).size !== 3 || publicCards.some(c => !Number.isInteger(c) || c < 0 || c > 51))
    throw Error('The Princess opening cards are unavailable.');
  return {
    rulesVersion: princessPrecommittedRules, profileId: princessPrecommittedProfile,
    selectionModel: 'PRECOMMITTED_CHAIR_WEIGHTS', publicCards: [...publicCards],
    winCompletions: [], totalCompletions: 0, feeBps: 500,
    targetRtpPpm: table.rtpBps * 100, probabilityWeights: table.weights,
    grossMultiplierPpm: table.areas.map(a => princessMultiplierPpm(a.grossNumerator, a.grossDenominator)),
    grossNumerators: table.areas.map(a => a.grossNumerator), grossDenominators: table.areas.map(a => a.grossDenominator),
    netNumerators: table.areas.map(a => a.netNumerator), netDenominators: table.areas.map(a => a.netDenominator),
    maximumMultiplier: config.maximumPayoutMultiplier, configVersion: config.economyVersion ?? 0,
    maximumBet: config.maximumBet,
    maximumSingleRoundPayout: config.maximumSingleRoundPayout ?? princessDefaultSinglePayout,
    maximumRoundExposure: config.maximumRoundExposure ?? princessSettlementCeiling,
    rounding: 'NET_FLOOR_GROSS_CEIL_FEE_DIFFERENCE',
  };
}

/** Choose the winner independently of the uniformly sampled opening cards.
 * Complete the SAME 52-card deck until its strongest valid hand agrees with
 * that committed chair. This is a disclosed weighted deal, NOT a uniform
 * shuffle claim. No user, bet, balance, history or exposure enters this API.
 */
export function dealPrecommittedPrincess(weights: readonly number[], draw: (max: number) => number = randomInt) {
  if (weights.length !== 3 || weights.some(w => !Number.isSafeInteger(w) || w <= 0 || w > 1_000_000))
    throw Error('Princess requires three positive, precommitted chair weights.');
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = draw(total), winner = 0;
  while (roll >= weights[winner]) { roll -= weights[winner]; winner++; }
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 0; i < 3; i++) {
    const j = i + draw(52 - i); [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const publicCards = deck.slice(0, 3), remaining = deck.slice(3);
  for (let attempt = 1; attempt <= 512; attempt++) {
    const privateDeck = [...remaining];
    for (let i = 0; i < 6; i++) {
      const j = i + draw(49 - i); [privateDeck[i], privateDeck[j]] = [privateDeck[j], privateDeck[i]];
    }
    const outcome = chairOutcomeFromDeck([...publicCards, ...privateDeck]);
    if (outcome.winner === teenPattiChairs[winner]) return {
      ...outcome, selectionModel: 'PRECOMMITTED_CHAIR_WEIGHTS',
      probabilityWeights: [...weights], publicStartingCard: true,
    };
  }
  // Never silently change a chosen outcome or use a fallback influenced by
  // demand. An un-opened round can retry safely; no wager has been accepted.
  throw Error('The Princess round could not be prepared. Please retry.');
}

export function assertPrincessExposure(config: GameRuntimeConfig,
  accepted: readonly { application_user_id: string; target_id: string; amount: number }[],
  userId: string, incoming: Record<string, number>) {
  const table = princessPrecommittedPaytable(config);
  const all: Record<string, number> = { green: 0, blue: 0, red: 0 };
  const mine = { ...all };
  for (const bet of accepted) {
    if (!teenPattiChairs.includes(bet.target_id as typeof teenPattiChairs[number])) throw Error('The Princess wager state is unavailable.');
    if (!Number.isSafeInteger(Number(bet.amount)) || Number(bet.amount) < 0) throw Error('The Princess wager state is unavailable.');
    all[bet.target_id] += Number(bet.amount);
    if (bet.application_user_id === userId) mine[bet.target_id] += Number(bet.amount);
  }
  for (const chair of teenPattiChairs) { all[chair] += incoming[chair] ?? 0; mine[chair] += incoming[chair] ?? 0; }
  const wager = Object.values(mine).reduce((s, n) => s + n, 0);
  if (!Number.isSafeInteger(wager) || wager > config.maximumBet) throw Error('The Princess round bet limit has been reached. Try a smaller wager.');
  for (const a of table.areas) {
    if (princessNetReturn(mine[a.chair], a.netNumerator, a.netDenominator) > (config.maximumSingleRoundPayout ?? princessDefaultSinglePayout))
      throw Error('The Princess payout limit has been reached. Try a smaller wager.');
    // Conservative ceiling of every possible chair liability, independent
    // of the already committed winning chair. No accepted payout is clipped.
    if (princessNetReturn(all[a.chair], a.netNumerator, a.netDenominator, true) > (config.maximumRoundExposure ?? princessSettlementCeiling))
      throw Error('The Princess table exposure limit has been reached. Try a smaller wager or the next round.');
  }
  return wager - Object.values(incoming).reduce((s, n) => s + n, 0);
}
