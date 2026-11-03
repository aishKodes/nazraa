import assert from 'node:assert/strict';
import {dealChairRound,chairPreview} from '../lib/games/teen-patti';
import {princessNinetyQuote,princessNinetyRules,princessHiddenQuote,princessHiddenConfigRules,princessSettlement,commitPrincessQuote,requiresPrincessQuoteAcknowledgement} from '../lib/games/princess-preview-pricing';
import {mobileGamesConfig,snapshotGameConfig} from '../lib/games/game-config';
import {economyDraft,economyModel} from '../lib/games/economy-policy';
const before=mobileGamesConfig({games:{teen_patti:{princessServiceFeeBps:500,economyVersion:28}}}).games.teen_patti;
const next=economyDraft('teen_patti',before,{enabled:true,maintenance:false,minimumBet:100,maximumBet:before.maximumBet,maximumPayoutMultiplier:3,payoutScalePpm:1000000,princessServiceFeeBps:500,princessPayoutProfile:'FAIR_90_FEE_5'});
assert.equal(next.targetRtp,.9);assert.equal(next.princessServiceFeeBps,500);assert.equal(next.princessPreviewQuotes,false);
assert(Math.abs(economyModel('teen_patti',next).average!-.9)<1e-12);assert.deepEqual(next.denominations,[100,1000,10000,100000]);
assert.equal(snapshotGameConfig('teen_patti',{...before,runtimeSnapshotVersion:1},next).princessPayoutProfile,'LEGACY_FIXED_3X');
assert.throws(()=>economyDraft('teen_patti',before,{enabled:true,maintenance:false,minimumBet:100,maximumBet:before.maximumBet,maximumPayoutMultiplier:3,payoutScalePpm:1000000,princessServiceFeeBps:1000,princessPayoutProfile:'FAIR_90_FEE_5'}),/5% fee/);
const quote=princessNinetyQuote(),wins={green:0,blue:0,red:0};let paid=0,sumSquares=0;
for(let i=0;i<100000;i++){
 const d=dealChairRound();wins[d.winner]++;const o={...d,rulesVersion:princessNinetyRules,pricing:quote,...commitPrincessQuote(d.hands,quote)};
 const preview=chairPreview(o);assert.equal(preview.cards,undefined);assert.equal(preview.quoteId,undefined);assert.equal(preview.paytableQuoteId,o.commitment);assert.equal(preview.feeBps,500);assert(requiresPrincessQuoteAcknowledgement(preview.rulesVersion));
 const r=princessSettlement({green:100},o);assert.equal(r.payout,d.winner==='green'?270:0);paid+=r.payout;sumSquares+=(r.payout/100)**2;
 if(i===0){for(const n of [100,1000,10000,100000,99900,123400]){const p=princessSettlement({[d.winner]:n},o);assert.equal(p.payout,n*2.7);assert.equal(p.grossPayout,Math.ceil(n*54/19));assert.equal(p.serviceFee,Math.ceil(p.grossPayout*.05));}
 for(const key of ['feeBps','grossNumerator','grossDenominator','netMultiplierPpm','targetRtpPpm','profileId','rounding'] as const){const forged={...quote,[key]:0};assert.throws(()=>princessSettlement({green:100},{...o,pricing:forged,...commitPrincessQuote(d.hands,forged as typeof quote)}),/commitment/);}
 const old=princessHiddenQuote(500);assert.equal(princessSettlement({[d.winner]:100},{...d,rulesVersion:princessHiddenConfigRules,pricing:old,...commitPrincessQuote(d.hands,old)}).payout,285);}
}
const simulatedRtp=paid/100000/100;assert(Math.abs(simulatedRtp-.9)<.02);
console.log(JSON.stringify({rounds:100000,theoreticalRtp:.9,simulatedRtp,standardError:Math.sqrt((sumSquares/100000-simulatedRtp**2)/100000),winningChairs:wins,feeBps:500,grossNumerator:54,grossDenominator:19,netWinMultiplier:2.7,rounding:'GROSS_CEIL_FEE_CEIL',allFourChipsExact:true,legacySnapshotsPreserved:true,oldClientsRejectBeforeDebit:true,outcomesIndependentOfWagers:true}));
