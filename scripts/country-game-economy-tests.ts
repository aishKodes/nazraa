import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type mysql from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import type {Scope,Role} from '@/types/platform';
import {roles} from '@/types/platform';
import {mobileGamesConfig,effectiveMobileGamesConfig,snapshotGameConfig} from '@/lib/games/game-config';
import {panelCountries,canonicalCountryCode} from '@/lib/countries';
import {scopeFor,accountByManagementId} from '@/lib/db/repositories/accounts';
import {createPlatformAccount} from '@/lib/db/repositories/administration';
import {countryManagement,assignCountryManager,requireCountryAccess} from '@/lib/db/repositories/country-management';
import {currentGameEconomy,previewGameEconomy,publishGameEconomy,gameEconomyDashboard} from '@/lib/db/repositories/game-economy';
import {economyModel,simulateEconomy,type EconomyDraft} from '@/lib/games/economy-policy';
import {gameSharedRoundState,placeSharedGameBets,maintainSharedGameRounds} from '@/lib/db/repositories/mobile-product';
import {saveHostPayoutAccount,requestHostPayout} from '@/lib/db/repositories/host-payouts';

export async function verifyCountryGameEconomy(root:mysql.Connection,user:(name:string)=>Promise<MobileIdentity>,master:Scope){
  const legacyStored={games:{luck77:{minimumBet:700,payoutScalePpm:800000},greedy_king:{minimumBet:900}}};
  assert.deepEqual(effectiveMobileGamesConfig(JSON.stringify(legacyStored)),mobileGamesConfig(JSON.stringify(legacyStored)),'text-format legacy runtime remains unchanged');
  const versioned={games:{...legacyStored.games,luck77:{...legacyStored.games.luck77,economyVersion:1}}};
  const resolved=effectiveMobileGamesConfig(JSON.stringify(versioned));assert.equal(resolved.games.luck77.minimumBet,700);assert.equal(resolved.games.greedy_king.minimumBet,500,'publishing one game never activates unrelated legacy settings');
  const baseline=mobileGamesConfig({}).games.luck77;
  assert.equal(snapshotGameConfig('luck77',JSON.stringify(legacyStored.games.luck77),baseline).minimumBet,100,'migration retains previous text-format runtime');
  assert.equal(snapshotGameConfig('luck77',JSON.stringify({...resolved.games.luck77,runtimeSnapshotVersion:1}),baseline).minimumBet,700,'new text-format snapshots preserve the deliberately published version');
  assert.equal(snapshotGameConfig('luck77',legacyStored.games.luck77,baseline).minimumBet,700,'native JSON migration retains its original configuration');
  const managers:Scope[]=[];
  for(const code of ['SA','AE','NP','NG','DZ','MA']){
    assert.equal(panelCountries.filter(c=>c.code===code).length,1);
    const created=await createPlatformAccount({scope:master,role:'COUNTRY_MANAGER',fullName:`QA ${code} manager`,countryCode:code,password:'Isolated-Local-QA-2026!',documents:[]});
    const sa=await createPlatformAccount({scope:master,role:'SUPER_ADMIN',requestedParentId:created.accountId,fullName:`QA ${code} Super Admin`,countryCode:code,password:'Isolated-Local-QA-2026!',documents:[]});
    const admin=await createPlatformAccount({scope:master,role:'ADMIN',requestedParentId:sa.accountId,fullName:`QA ${code} Admin`,countryCode:code,password:'Isolated-Local-QA-2026!',documents:[]});
    const agency=await createPlatformAccount({scope:master,role:'AGENCY',requestedParentId:admin.accountId,fullName:`QA ${code} Agency`,countryCode:code,password:'Isolated-Local-QA-2026!',documents:[]});
    const host=await user(`QA ${code} Host`);
    await root.execute('UPDATE application_users SET country_code=?,agency_account_id=? WHERE id=?',[code,agency.accountId,host.userId]);
    const manager=await scopeFor((await accountByManagementId(String(created.publicId)))!);managers.push(manager);
    assert.equal(manager.countryCode,code);
    const other=code==='MA'?'NG':'MA';assert.throws(()=>requireCountryAccess(manager,other),/denied/);
    assert.equal(requireCountryAccess(manager,code),code);
    const data=await countryManagement(manager,code);assert.deepEqual(data.countries.map(c=>c.code),[code]);
    assert.equal(data.people.length,1);assert.equal(String(data.people[0].public_id),host.publicId);
    assert.equal(data.countries[0].agencies,1);assert.equal(data.countries[0].admins,1);assert.equal(data.countries[0].users,1);assert.equal(data.countries[0].hosts,1);assert.equal(data.countries[0].coins,5000);
    if(code==='NG'){
      await root.execute("INSERT INTO wallet_balances(id,owner_type,owner_id,asset_type,available_balance) VALUES(?,'APPLICATION_USER',?,'DIAMOND',125000)",[randomUUID(),host.userId]);
      const method=await saveHostPayoutAccount(host.userId,{type:'UPI',displayName:'Local country payout fixture',destination:'local-country-qa@bank'});
      await requestHostPayout(host.userId,{amount:125000,payoutMethodId:method.id,idempotencyKey:randomUUID()});
      const paid=await countryManagement(manager,code);
      assert.equal(paid.countries[0].payoutRequests,1);assert.equal(paid.countries[0].payoutPending,1);assert.equal(paid.countries[0].hostUsd,10);assert.equal(paid.countries[0].agencyUsd,1.1,'country totals use real Host payout snapshots, not absent legacy distribution rows');
    }
  }
  assert.equal(canonicalCountryCode('  Dubai '),'AE');assert.equal(canonicalCountryCode('UAE'),'AE');assert.equal(canonicalCountryCode('United Arab Emirates'),'AE');assert.equal(canonicalCountryCode('KSA'),'SA');
  const global=await countryManagement(master);for(const code of ['SA','AE','NP','NG','DZ','MA','IN','BD'])assert.equal(global.countries.filter(c=>c.code===code).length,1);
  for(const role of roles.filter(r=>!['MASTER','COUNTRY_MANAGER'].includes(r)))assert.throws(()=>requireCountryAccess({...master,account:{...master.account,role}},'NG'),/denied/);
  await assignCountryManager(master,{accountId:managers[0].account.id,countryCode:'SA',reason:'Isolated same-country assignment test'});
  await assert.rejects(()=>assignCountryManager(master,{accountId:managers[0].account.id,countryCode:'MA',reason:'Do not reclassify an occupied country branch'}),/another or unassigned country/);
  await assert.rejects(()=>assignCountryManager(managers[0],{accountId:managers[1].account.id,countryCode:'NG',reason:'Forbidden cross-country assignment'}),/Only Master/);
  console.log('PASS six canonical countries, UAE aliases, preserved existing countries, each Country Manager scoped to own country, every cross-country request denied, Master-only assignment');

  const settings=(await currentGameEconomy(master)).settings,cfg=settings.games.luck77;
  await root.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.games',?,?) ON DUPLICATE KEY UPDATE setting_value=setting_value",[JSON.stringify(settings),master.account.id]);
  const draft:EconomyDraft={enabled:cfg.enabled,maintenance:cfg.maintenance,minimumBet:cfg.minimumBet,maximumBet:cfg.maximumBet,maximumPayoutMultiplier:cfg.maximumPayoutMultiplier,payoutScalePpm:cfg.payoutScalePpm,outcomeWeights:cfg.outcomeWeights};
  for(const role of roles.filter(r=>r!=='MASTER')){
    const denied={...master,account:{...master.account,role:role as Role}};
    await assert.rejects(()=>previewGameEconomy(denied,'luck77',draft),/Only Master/);
    await assert.rejects(()=>publishGameEconomy(denied,'luck77',draft,0,'Forbidden change'),/Only Master/);
    await assert.rejects(()=>gameEconomyDashboard(denied),/Only Master/);
  }
  const preview=await previewGameEconomy(master,'luck77',draft);
  const v1=await publishGameEconomy(master,'luck77',draft,preview.expectedVersion,'Isolated baseline snapshot');
  await assert.rejects(()=>publishGameEconomy(master,'luck77',draft,preview.expectedVersion,'Stale preview rejected'),/Configuration changed/);
  const h=await user('Economy snapshot player');
  const state=await gameSharedRoundState(h,'luck77');
  const round=state.round.id;
  await root.execute(`UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 20 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 21 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 26 SECOND,
    outcome_json=JSON_OBJECT('winner','seven','multiplier',8,'winningSegment',0) WHERE id=?`,[round]);
  const requestId=randomUUID();await placeSharedGameBets(h,{game:'luck77',roundId:round,requestId,bets:{seven:100}});
  await placeSharedGameBets(h,{game:'luck77',roundId:round,requestId,bets:{seven:100}});
  const [before]=await root.query<mysql.RowDataPacket[]>('SELECT config_version,config_json,outcome_json FROM game_shared_rounds WHERE id=?',[round]);
  assert.equal(Number(before[0].config_version),v1);
  const v2=await publishGameEconomy(master,'luck77',{...draft,payoutScalePpm:500_000,minimumBet:500},v1,'Isolated future-round economic change');
  const still=await gameSharedRoundState(h,'luck77');assert.equal(still.round.id,round);assert.equal(still.controls.minimumBet,100);
  // Expire this fixture without waiting; only an isolated database is used.
  await root.execute('UPDATE game_shared_rounds SET round_number=round_number-100,betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 3 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?',[round]);
  await maintainSharedGameRounds();await maintainSharedGameRounds();
  const [settled]=await root.query<mysql.RowDataPacket[]>('SELECT * FROM game_shared_settlements WHERE round_id=?',[round]);
  assert.equal(settled.length,1);const gross=Math.floor(800*cfg.payoutScalePpm/1_000_000);assert.equal(Number(settled[0].payout_total),gross-Math.floor(gross*.01));
  const [credits]=await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM ledger_transactions WHERE idempotency_key=?",[`SHARED_GAME:${round}:${h.userId}:CREDIT`]);assert.equal(Number(credits[0].n),1);
  const next=await gameSharedRoundState(h,'luck77');assert.notEqual(next.round.id,round);assert.equal(next.controls.minimumBet,500);
  const [versions]=await root.query<mysql.RowDataPacket[]>('SELECT config_version,config_json FROM game_shared_rounds WHERE id=?',[next.round.id]);assert.equal(Number(versions[0].config_version),v2);
  const [immutable]=await root.query<mysql.RowDataPacket[]>('SELECT config_json,outcome_json FROM game_shared_rounds WHERE id=?',[round]);assert.deepEqual(immutable[0],{config_json:before[0].config_json,outcome_json:before[0].outcome_json});
  const dashboard=await gameEconomyDashboard(master),g=dashboard.games.find(g=>g.game==='luck77')!;
  assert.equal(g.staked,100);assert.equal(g.paid,Number(settled[0].payout_total));assert.equal(g.observed,g.paid/100);assert.equal(g.rounds,1);assert.equal(dashboard.history.length,2);
  assert.ok(dashboard.history.every(v=>String(v.actor_id)===String(master.account.publicId)&&v.reason&&v.effective_at));
  const princess=settings.games.teen_patti;
  await assert.rejects(()=>previewGameEconomy(master,'teen_patti',{enabled:true,maintenance:false,minimumBet:100,maximumBet:princess.maximumBet,maximumPayoutMultiplier:2.9,payoutScalePpm:1_000_000}),/3.00/);
  const model=economyModel('teen_patti',princess);assert.ok(Math.abs(model.average!-.97)<1e-10);
  const sim=await simulateEconomy('luck77',cfg,100_000);assert.ok(Math.abs(sim.simulatedRtp-sim.theoreticalRtp)<.03);
  console.log(`PASS game RBAC all roles; preview/version conflict; v${v1} round settles once at old scale after v${v2} edit; next round uses new scale/limits; immutable outcome/config; dashboard matches actual net payout; protected Princess 3x; wallet-free 100k simulation`);
}
