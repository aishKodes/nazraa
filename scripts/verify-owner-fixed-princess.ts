import assert from 'node:assert/strict';
import {chairOutcomeFromDeck,chairPreview} from '../lib/games/teen-patti';
import {mobileGamesConfig} from '../lib/games/game-config';
import {princessFixedQuote,princessFixedQuoteRules,princessQuoteRules,princessSettlement,commitPrincessQuote} from '../lib/games/princess-preview-pricing';

const dealt=chairOutcomeFromDeck(Array.from({length:52},(_,i)=>i));
const pricing=princessFixedQuote(dealt.hands.map(h=>h.cards[0]));
const outcome={...dealt,rulesVersion:princessFixedQuoteRules,pricing,...commitPrincessQuote(dealt.hands,pricing,'isolated-qa-nonce')};
assert.deepEqual(chairPreview(outcome).grossMultiplierPpm,[3_000_000,3_000_000,3_000_000]);
for(const winner of ['green','blue','red']) {
  const paid=princessSettlement({[winner]:100},{...outcome,winner});
  assert.deepEqual(paid,{wager:100,grossPayout:300,serviceFee:9,payout:291});
  assert.deepEqual(princessSettlement({[winner]:100},{...outcome,winner}),paid,'pure deterministic retry');
}
const forged={...pricing,grossMultiplierPpm:[3_000_001,3_000_000,3_000_000]};
assert.throws(()=>princessSettlement({green:100},{...outcome,pricing:forged,...commitPrincessQuote(dealt.hands,forged)}),/commitment/);
const oldPricing={...pricing,rulesVersion:princessQuoteRules,grossMultiplierPpm:[2_250_000,3_200_000,3_800_000],maximumMultiplier:30};
const historical={...dealt,winner:'green',rulesVersion:princessQuoteRules,pricing:oldPricing,...commitPrincessQuote(dealt.hands,oldPricing,'legacy-qa-nonce')};
assert.deepEqual(princessSettlement({green:100},historical),{wager:100,grossPayout:225,serviceFee:7,payout:218},'accepted V3 snapshot must not become 3x');
const config=mobileGamesConfig({games:{teen_patti:{princessPreviewQuotes:true,maximumPayoutMultiplier:30}}});
assert.equal(config.games.teen_patti.maximumPayoutMultiplier,3);
assert.deepEqual(config.games.teen_patti_pro,mobileGamesConfig({}).games.teen_patti_pro,'Pro is unchanged');
console.log('PASS fixed Princess: each chair 100→300 gross−9 fee=291 returned, immutable V3 accepted quote, fixed-paytable validation, deterministic retry, canonical 3x cap and unchanged Pro.');
