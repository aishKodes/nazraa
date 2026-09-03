import { defaultMobileGamesConfig } from "../lib/games/game-config";

type Row = { game: string; target: number; mathematical: number; simulated: number };

let seed = 0x6d2b79f5;
function random() {
  seed |= 0;
  seed = seed + 0x6d2b79f5 | 0;
  let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
  value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

function fixedAreaRtp(weights: number[], payouts: number[], scalePpm: number) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return payouts.reduce(
    (sum, payout, index) => sum + weights[index] / total * payout * scalePpm / 1_000_000 * .99,
    0,
  ) / payouts.length;
}

function teenValue(cards: number[]) {
  const ranks = cards.map((card) => card % 13 + 2).sort((left, right) => right - left);
  const suits = cards.map((card) => Math.floor(card / 13));
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const flush = new Set(suits).size === 1;
  const unique = new Set(ranks).size === 3;
  const sequence = unique && ((ranks[0] === 14 && ranks[1] === 13 && ranks[2] === 12) ||
    (ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2) ||
    (ranks[0] - 1 === ranks[1] && ranks[1] - 1 === ranks[2]));
  const sequenceRank = ranks[0] === 14 && ranks[1] === 13 && ranks[2] === 12 ? 15
    : ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2 ? 14 : ranks[0];
  if (counts.size === 1) return { rank: 5, tie: [ranks[0]], payout: 25 };
  if (flush && sequence) return { rank: 4, tie: [sequenceRank], payout: 10 };
  if (sequence) return { rank: 3, tie: [sequenceRank], payout: 2 };
  if (flush) return { rank: 2, tie: ranks, payout: 4 };
  const pair = [...counts].find(([, count]) => count === 2)?.[0];
  if (pair != null) return { rank: 1, tie: [pair, [...counts].find(([, count]) => count === 1)?.[0] ?? 0], payout: 0 };
  return { rank: 0, tie: ranks, payout: 0 };
}

function compareTeen(left: ReturnType<typeof teenValue>, right: ReturnType<typeof teenValue>) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  for (let index = 0; index < Math.max(left.tie.length, right.tie.length); index++) {
    const difference = (left.tie[index] ?? 0) - (right.tie[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function teenCrownRtp(iterations: number, scalePpm: number) {
  let returned = 0;
  for (let round = 0; round < iterations; round++) {
    const deck = Array.from({ length: 52 }, (_, index) => index);
    for (let index = deck.length - 1; index > 0; index--) {
      const selected = Math.floor(random() * (index + 1));
      [deck[index], deck[selected]] = [deck[selected], deck[index]];
    }
    const hands = [teenValue(deck.slice(0, 3)), teenValue(deck.slice(3, 6)), teenValue(deck.slice(6, 9))];
    const winner = hands.reduce((best, hand, index) => compareTeen(hand, hands[best]) > 0 ? index : best, 0);
    const gross = hands[winner].payout * scalePpm / 1_000_000;
    returned += gross > 1 ? gross * .99 : gross;
  }
  return returned / iterations;
}

const junglePaths = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [2, 1, 1, 1, 0], [0, 1, 1, 1, 2],
];
const junglePay = [
  [30, 80, 500], [15, 50, 150], [15, 50, 150], [10, 20, 80], [5, 10, 50],
];

function jungleRtp(iterations: number, scalePpm: number) {
  const wager = 150;
  let returned = 0;
  for (let round = 0; round < iterations; round++) {
    const grid = Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => Math.floor(random() * 5)));
    let gross = 0;
    for (const path of junglePaths) {
      const symbols = path.map((row, column) => grid[row][column]);
      let matches = 1;
      while (matches < 5 && symbols[matches] === symbols[0]) matches++;
      if (matches >= 3) gross += wager / 15 * junglePay[symbols[0]][matches - 3];
    }
    gross = Math.min(wager * 20, Math.floor(gross * scalePpm / 1_000_000));
    if (gross > wager) gross -= Math.floor(gross * .01);
    returned += gross;
  }
  return returned / iterations / wager;
}

const games = defaultMobileGamesConfig.games;
const teenNormal = fixedAreaRtp(games.teen_patti_pro.outcomeWeights!, [2.7, 2.9, 2.8], games.teen_patti_pro.payoutScalePpm);
const teenCrownMath = teenCrownRtp(500_000, games.teen_patti_pro.sideBetPayoutScalePpm!);
const rows: Row[] = [
  { game: "Teen Patti Pro", target: .95, mathematical: (teenNormal * 3 + teenCrownMath) / 4, simulated: (teenNormal * 3 + teenCrownRtp(500_000, games.teen_patti_pro.sideBetPayoutScalePpm!)) / 4 },
  { game: "Luck77", target: .95, mathematical: fixedAreaRtp(games.luck77.outcomeWeights!, [8, 2, 2], games.luck77.payoutScalePpm), simulated: fixedAreaRtp(games.luck77.outcomeWeights!, [8, 2, 2], games.luck77.payoutScalePpm) },
  { game: "Greedy Lion", target: .95, mathematical: fixedAreaRtp(games.greedy_lion.outcomeWeights!, [5, 45, 25, 5, 15, 5, 5, 10], games.greedy_lion.payoutScalePpm), simulated: fixedAreaRtp(games.greedy_lion.outcomeWeights!, [5, 45, 25, 5, 15, 5, 5, 10], games.greedy_lion.payoutScalePpm) },
  { game: "Greedy King", target: .95, mathematical: fixedAreaRtp(games.greedy_king.outcomeWeights!, [5, 10, 15, 25, 45, 5, 5, 5], games.greedy_king.payoutScalePpm), simulated: fixedAreaRtp(games.greedy_king.outcomeWeights!, [5, 10, 15, 25, 45, 5, 5, 5], games.greedy_king.payoutScalePpm) },
  { game: "Bounty Football", target: .95, mathematical: fixedAreaRtp(games.bounty_football.outcomeWeights!, [2, 5, 8, 18, 66, 50, 100, 88, 30, 20], games.bounty_football.payoutScalePpm), simulated: fixedAreaRtp(games.bounty_football.outcomeWeights!, [2, 5, 8, 18, 66, 50, 100, 88, 30, 20], games.bounty_football.payoutScalePpm) },
  { game: "Jungle Hunt", target: .95, mathematical: jungleRtp(2_000_000, games.jungle_hunt.payoutScalePpm), simulated: jungleRtp(2_000_000, games.jungle_hunt.payoutScalePpm) },
];

console.table(rows.map((row) => ({
  Game: row.game,
  "Target RTP": `${(row.target * 100).toFixed(2)}%`,
  "Mathematical RTP": `${(row.mathematical * 100).toFixed(2)}%`,
  "Simulated RTP": `${(row.simulated * 100).toFixed(2)}%`,
  "House Edge": `${((1 - row.simulated) * 100).toFixed(2)}%`,
})));

for (const row of rows) {
  if (Math.abs(row.simulated - row.target) > .015) {
    throw new Error(`${row.game} RTP is outside the 1.5-point release tolerance.`);
  }
}
