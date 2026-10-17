import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import type {Scope} from '@/types/platform';
import * as product from '@/lib/db/repositories/mobile-product';
import {savePrincessPricing} from '@/lib/db/repositories/catalog';
import {princessSettlement,commitPrincessQuote,type PrincessQuote} from '@/lib/games/princess-preview-pricing';

/** All financial writes run in the ephemeral core QA database, never prod. */
export async function verifyPrincessQuotes(root:Connection,owner:MobileIdentity,master:Scope){
 const [settings]=await root.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.games'");
 const old=settings[0]?.setting_value;
 const original=await product.gameSharedRoundState(owner,'teen_patti');
 const [historic]=await root.query<RowDataPacket[]>('SELECT outcome_json FROM game_shared_rounds WHERE id=?',[original.round.id]);
 // Free only the test clock slot. No hand, wager, settlement or payout changes.
 await root.execute('UPDATE game_shared_rounds SET round_number=round_number-1000000 WHERE id=?',[original.round.id]);
 try{
  await assert.rejects(savePrincessPricing({scope:{...master,account:{...master.account,role:'ADMIN'}},mode:'PUBLIC_QUOTE_V3',targetRtp:.97,maximumMultiplier:30,reason:'QA forbidden price change'}),/Forbidden/);
  await savePrincessPricing({scope:master,mode:'PUBLIC_QUOTE_V3',targetRtp:.97,maximumMultiplier:30,reason:'QA owner-approved visible-card quote pricing'});
  const current=await product.gameSharedRoundState(owner,'teen_patti');
  assert.equal(current.publicPreview?.rulesVersion,'PRINCESS_PUBLIC_CARD_QUOTE_V3');
  assert.equal(current.publicPreview?.cards?.length,3);
  assert.equal(current.outcome,null,'public card/quote never discloses the hidden hand or winner');
  const quoteId=String(current.publicPreview?.quoteId);
  assert.match(quoteId,/^[a-f0-9]{64}$/);
  await root.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 30 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 31 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 36 SECOND WHERE id=?',[current.round.id]);
  const bets={green:1000,blue:1000,red:1000},requestId=randomUUID();
  await assert.rejects(product.placeSharedGameBets(owner,{requestId:randomUUID(),game:'teen_patti',roundId:current.round.id,bets}),/latest Nazraa/);
  assert.equal((await product.gameSharedRoundState(owner,'teen_patti')).walletBalance,current.walletBalance,'legacy APK quote denial must not debit');
  const accepted=await Promise.all(Array.from({length:3},()=>product.placeSharedGameBets(owner,{requestId,game:'teen_patti',roundId:current.round.id,bets,quoteId})));
  const [wallet]=await root.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='COIN'",[owner.userId]);
  const [debits]=await root.query<RowDataPacket[]>('SELECT wager_total FROM game_shared_bet_requests WHERE request_id=? AND application_user_id=?',[requestId,owner.userId]);
  assert.equal(debits.length,1,'concurrent retries create one durable wager');assert.equal(Number(debits[0].wager_total),3000);
  assert(accepted.every(r=>r.walletBalance===Number(wallet[0].available_balance)),`all duplicate acknowledgements must use current wallet, got ${accepted.map(r=>r.walletBalance).join(',')} expected ${wallet[0].available_balance}`);
  await assert.rejects(product.placeSharedGameBets(owner,{requestId,game:'teen_patti',roundId:current.round.id,bets,quoteId:'f'.repeat(64)}),/already used/);
  const [rounds]=await root.query<RowDataPacket[]>('SELECT outcome_json FROM game_shared_rounds WHERE id=?',[current.round.id]);
  const outcome=typeof rounds[0].outcome_json==='string'?JSON.parse(rounds[0].outcome_json):rounds[0].outcome_json;
  assert.equal(commitPrincessQuote(outcome.hands,outcome.pricing as PrincessQuote,outcome.nonce).commitment,quoteId,'proof survives MySQL JSON key order');
  const expected=princessSettlement(bets,outcome);
  await savePrincessPricing({scope:master,mode:'PUBLIC_QUOTE_V3',targetRtp:.90,maximumMultiplier:10,reason:'QA future pricing cannot change accepted wagers'});
  const [same]=await root.query<RowDataPacket[]>('SELECT outcome_json FROM game_shared_rounds WHERE id=?',[current.round.id]);
  assert.deepEqual(same[0].outcome_json,rounds[0].outcome_json,'config edits must not rewrite round snapshots');
  await root.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 10 SECOND WHERE id=?',[current.round.id]);
  await product.maintainSharedGameRounds();await product.maintainSharedGameRounds();
  const [settled]=await root.query<RowDataPacket[]>('SELECT gross_payout,deduction_total,payout_total FROM game_shared_settlements WHERE round_id=? AND application_user_id=?',[current.round.id,owner.userId]);
  assert.equal(settled.length,1);
  assert.deepEqual([Number(settled[0].gross_payout),Number(settled[0].deduction_total),Number(settled[0].payout_total)],[expected.grossPayout,expected.serviceFee,expected.payout]);
  const [untouched]=await root.query<RowDataPacket[]>('SELECT outcome_json FROM game_shared_rounds WHERE id=?',[original.round.id]);
  assert.deepEqual(untouched[0].outcome_json,historic[0].outcome_json,'legacy settled hand remains immutable');
  console.log('PASS Princess V3 DB: real public cards/committed quotes, legacy APK rejected without debit, concurrent retry once, quote collision rejected, canonical proof round-trip, immutable old/new payout snapshots, Master-only audited config and same-round exact-once settlement.');
 }finally{
  if(old===undefined)await root.execute("DELETE FROM system_settings WHERE setting_key='mobile.games'");
  else await root.execute("UPDATE system_settings SET setting_value=? WHERE setting_key='mobile.games'",[typeof old==='string'?old:JSON.stringify(old)]);
 }
}
