import type {GameRuntimeConfig} from './game-config';
const princessChairs=['green','blue','red'] as const;
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
  const areas = princessChairs.map((chair, i) => {
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
