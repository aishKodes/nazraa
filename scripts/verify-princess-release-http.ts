import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import mysql from 'mysql2/promise';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
async function main(){
 const q=JSON.parse(await readFile('/tmp/nazraa-owner-staging-fixtures.json','utf8'));assert.match(q.database,/^nazraa_mobile_qa_\d+$/);
 Object.assign(process.env,{DB_HOST:'127.0.0.1',DB_NAME:q.database,DB_USER:'root',DB_SSL:'false',DB_PASSWORD:'',DB_PORT:'3306'});
 const c=await mysql.createConnection({host:'127.0.0.1',user:'root',database:q.database,timezone:'Z'});global.nazraaPool=mysql.createPool({host:'127.0.0.1',user:'root',database:q.database,timezone:'Z',connectionLimit:4});global.nazraaInstrumentedPool=global.nazraaPool;
 let previous:unknown;
 async function api(path:string,body?:unknown){const r=await fetch('http://127.0.0.1:3998/api/v1/mobile/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+q.fixtures[0].token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert(r.ok,JSON.stringify({status:r.status,message:data.message}));return data;}
 try{
  const [[row]]=await c.query<mysql.RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.games'");previous=row?.setting_value??null;const raw=typeof previous==='string'?JSON.parse(previous):previous;
  const {mobileGamesConfig}=await import('../lib/games/game-config');const games=mobileGamesConfig(raw);games.games.teen_patti={...games.games.teen_patti,enabled:true,maintenance:false,princessPreviewQuotes:false,princessServiceFeeBps:500,targetRtp:.95,economyVersion:142,denominations:[100,1000,10000,100000]};
  await c.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) SELECT 'mobile.games',?,id FROM platform_accounts WHERE role='MASTER' LIMIT 1 ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",[JSON.stringify(games)]);
  let state:any;
  for(let i=0;i<40;i++){state=await api('game-state?game=teen_patti');if(state.round.phase==='BETTING'&&state.publicPreview?.feeBps===500&&new Date(state.round.bettingEndsAt).getTime()-Date.now()>500)break;await new Promise(r=>setTimeout(r,1000));}
  assert.equal(state.publicPreview.feeBps,500);assert.equal(state.publicPreview.cards,undefined);
  const [[before]]=await c.query<mysql.RowDataPacket[]>("SELECT available_balance n FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[q.fixtures[0].userId]);
  const input={requestId:randomUUID(),game:'teen_patti',roundId:state.round.id,bets:{green:100,blue:100,red:100},quoteId:state.publicPreview.commitment};
  await api('game-bets',input);await api('game-bets',input);
  await c.execute('UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 4 SECOND WHERE id=?',[input.roundId]);
  const {maintainSharedGameRounds}=await import('../lib/db/repositories/mobile-product');await maintainSharedGameRounds();await maintainSharedGameRounds();
  const [settlements]=await c.query<mysql.RowDataPacket[]>('SELECT gross_payout,deduction_total,payout_total,wager_total FROM game_shared_settlements WHERE round_id=? AND application_user_id=?',[input.roundId,q.fixtures[0].userId]);assert.equal(settlements.length,1);const settlement=settlements[0];assert.equal(Number(settlement.wager_total),300);assert.equal(Number(settlement.gross_payout),300);assert.equal(Number(settlement.deduction_total),15);assert.equal(Number(settlement.payout_total),285);
  const [[after]]=await c.query<mysql.RowDataPacket[]>("SELECT available_balance n FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[q.fixtures[0].userId]);assert.equal(Number(after.n),Number(before.n)-15);
  console.log('PRINCESS_HTTP_LEDGER_PASS: 3×100 stake, 300 gross, 15 fee, 285 net; repeated bet and maintenance yield one debit/settlement; wallet net -15; hidden committed cards; disposable localhost only.');
 }finally{if(previous!==undefined)await c.execute("UPDATE system_settings SET setting_value=? WHERE setting_key='mobile.games'",[typeof previous==='string'?previous:JSON.stringify(previous)]);await c.end();await global.nazraaPool?.end();global.nazraaPool=undefined;global.nazraaInstrumentedPool=undefined;}
}
main().catch(e=>{console.error(e);process.exitCode=1});
