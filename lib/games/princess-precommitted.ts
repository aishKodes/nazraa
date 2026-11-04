import { randomInt } from 'node:crypto';
import { chairOutcomeFromDeck, teenPattiChairs } from './teen-patti';
import type { GameRuntimeConfig } from './game-config';

import {princessPrecommittedRules,princessPrecommittedProfile,princessSettlementCeiling,princessDefaultSinglePayout} from './princess-contract';
export {princessPrecommittedRules,princessPrecommittedProfile,princessSettlementCeiling,princessDefaultSinglePayout} from './princess-contract';

import {princessPrecommittedPaytable,princessNetReturn,princessMultiplierPpm} from './princess-paytable';
export {princessPrecommittedPaytable,princessNetReturn,princessMultiplierPpm} from './princess-paytable';

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
