import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import type {Role,Scope} from '@/types/platform';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
async function main(){
 process.env.DOCUMENT_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const database=`nazraa_gm_qa_${Date.now()}`;
 const root=await mysql.createConnection({host:'127.0.0.1',user:'root',multipleStatements:true});
 await root.query("SET time_zone='+00:00'");
 await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);await root.query(`USE \`${database}\``);
 const pool=mysql.createPool({host:'127.0.0.1',user:'root',database,connectionLimit:8,decimalNumbers:true,timezone:'Z'});pool.on('connection',c=>{void c.query("SET time_zone='+00:00'");});global.nazraaPool=pool;global.nazraaInstrumentedPool=pool;
 const groups:string[]=[];let keep=false;
 try{
  for(const f of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())await root.query(await readFile('db/migrations/'+f,'utf8'));
  const accounts=await import('@/lib/db/repositories/accounts'),admin=await import('@/lib/db/repositories/administration'),gm=await import('@/lib/db/repositories/global-management'),dir=await import('@/lib/db/repositories/directory'),reports=await import('@/lib/db/repositories/owner-reports'),ops=await import('@/lib/db/repositories/operations'),monitor=await import('@/lib/db/repositories/monitoring'),catalog=await import('@/lib/db/repositories/catalog'),dash=await import('@/lib/db/repositories/dashboard'),payouts=await import('@/lib/db/repositories/host-payouts');
  await accounts.createInitialMaster({publicId:100001,fullName:'QA Master',password:'Local-QA-Only-2026!'});
  const master=await accounts.scopeFor((await accounts.accountByManagementId('100001'))!);
  const create=async(role:Role,parent:Scope,country:string,name:string,applicationUserId?:string)=>{const r=await admin.createPlatformAccount({scope:master,role,fullName:name,countryCode:country,password:'Local-QA-Only-2026!',requestedParentId:parent.account.id,documents:[],applicationUserId});return accounts.scopeFor((await accounts.accountById(r.accountId))!);};
  const ownerA=randomUUID(),ownerB=randomUUID();
  for(const [id,name,country] of [[ownerA,'QA Manager A owner','SA'],[ownerB,'QA Manager B owner','NG']])await root.execute('INSERT INTO application_users(id,external_user_id,full_name,country_code) VALUES(?,?,?,?)',[id,id,name,country]);
  const ga=await create('GLOBAL_MANAGER',master,'SA','QA Global A',ownerA),gb=await create('GLOBAL_MANAGER',master,'NG','QA Global B',ownerB);
  const ca=await create('COUNTRY_MANAGER',master,'SA','QA Country A'),cb=await create('COUNTRY_MANAGER',master,'SA','QA Same Country B'),cn=await create('COUNTRY_MANAGER',master,'NG','QA Country Nigeria');
  async function branch(cm:Scope,country:string,name:string){const sa=await create('SUPER_ADMIN',cm,country,name+' Super');const ad=await create('ADMIN',sa,country,name+' Admin');return create('AGENCY',ad,country,name+' Agency');}
  const aa=await branch(ca,'SA','A'),ab=await branch(cb,'SA','B'),an=await branch(cn,'NG','Nigeria');
  const middle=(await gm.globalManagement(master)).groups.find(g=>g.name==='Middle East')!;
  assert.deepEqual([...middle.countries].sort(),['SA','AE','QA','KW','BH','OM','YE','IQ','IR','JO','LB','SY','PS','IL','TR','EG','CY'].sort());
  const bgroup=await gm.saveCountryGroup(master,{name:'QA Other Region',active:true,countries:['NG','SA'],expectedVersion:0,reason:'QA separate team scope'});
  await gm.saveGlobalManager(master,{id:ga.account.id,name:'QA Global A',status:'ACTIVE',countries:[],groups:[middle.id],countryManagers:[ca.account.id],gamesEnabled:true,expectedVersion:0,reason:'QA assign Middle East team A'});
  await gm.saveGlobalManager(master,{id:gb.account.id,name:'QA Global B',status:'ACTIVE',countries:[],groups:[bgroup],countryManagers:[cb.account.id,cn.account.id],gamesEnabled:true,expectedVersion:0,reason:'QA assign independent team B'});
  let A=await accounts.scopeFor(ga.account),B=await accounts.scopeFor(gb.account);
  assert(A.countryCodes?.includes('SA'));assert(A.accountIds.includes(aa.account.id));assert(!A.accountIds.includes(ab.account.id));assert(!A.isGlobal);
  assert(B.accountIds.includes(ab.account.id));assert(!B.accountIds.includes(aa.account.id));
  await assert.rejects(gm.saveGlobalManager(A,{id:ga.account.id,name:'Escalation',status:'ACTIVE',countries:['NG'],groups:[],countryManagers:[cn.account.id],gamesEnabled:true,expectedVersion:1,reason:'QA unauthorized scope expansion'}),/Only Master/);
  await assert.rejects(gm.saveGlobalManager(master,{id:ga.account.id,name:'QA Global A',status:'ACTIVE',countries:[],groups:[middle.id],countryManagers:[cb.account.id],gamesEnabled:true,expectedVersion:1,reason:'QA cannot steal assigned manager'}),/another Global Manager/);
  groups.push('17 canonical Middle East mappings / A↔B team separation / no scope escalation');
  const people:Record<string,{id:string;publicId:string;hostId:string}>={};
  for(const [key,agency,country] of [['own',aa,'SA'],['sameCountryForeignTeam',ab,'SA'],['foreignCountry',an,'NG'],['wrongCountrySameTeam',aa,'NG']] as const){
   const id=randomUUID(),hostId=randomUUID();await root.execute("INSERT INTO application_users(id,external_user_id,full_name,agency_account_id,country_code,face_verification_status,onboarding_completed,is_host) VALUES(?,?,?,?,?,'VERIFIED',TRUE,TRUE)",[id,id,'QA '+key,agency.account.id,country]);
   await root.execute("INSERT INTO host_profiles(id,application_user_id,agency_account_id,country_code,status,verification_status) VALUES(?,?,?,?,'ACTIVE','VERIFIED')",[hostId,id,agency.account.id,country]);
   for(const asset of ['COIN','DIAMOND'])await root.execute("INSERT INTO wallet_balances(id,owner_type,owner_id,asset_type,available_balance) VALUES(?,'APPLICATION_USER',?,?,5000)",[randomUUID(),id,asset]);
   await root.execute("INSERT INTO game_round_results(id,client_round_id,application_user_id,game_name,bets_json,outcome_json,wager_total,payout_total,balance_after) VALUES(?,?,?,'luck77','{}','{}',100,240,5140)",[randomUUID(),randomUUID(),id]);
   const [[u]]=await root.query<RowDataPacket[]>('SELECT public_id FROM application_users WHERE id=?',[id]);people[key]={id,hostId,publicId:String(u.public_id)};
  }
  assert.deepEqual((await dir.listUsersPage(A)).items.map(u=>u.id),[people.own.id]);
  assert.deepEqual((await dir.listHostsPage(A)).items.map(h=>h.id),[people.own.hostId]);
  assert.equal((await dir.listUsersPage(A,{search:people.sameCountryForeignTeam.publicId})).items.length,0);
  assert.equal((await monitor.searchMonitoring(A,people.foreignCountry.publicId)).length,0);
  assert.equal((await monitor.searchMonitoring(A,people.wrongCountrySameTeam.publicId)).length,0);
  assert.equal((await reports.agencyHostReport(A,{},true)).items.length,1);
  assert.equal((await reports.gameManagementReport(A,{},true)).items.length,1);
  assert.equal((await reports.gameManagementReport(B,{},true)).items.length,2);
  assert.equal((await reports.hierarchyReport(A,{},true)).items.some(r=>r.name.includes('Nigeria')),false);
  assert.equal((await dash.getDashboardMetrics(A)).users,1);
  assert.equal((await dash.getDashboardMetrics(A)).hosts,1);
  assert.equal((await dir.searchCoinTransferRecipients(A,people.sameCountryForeignTeam.publicId)).length,0);
  await assert.rejects(ops.transferCoins({scope:A,recipientId:people.sameCountryForeignTeam.id,amount:100,reason:'QA foreign transfer forbidden',idempotencyKey:randomUUID()}),/not found/);
  await assert.rejects(ops.adjustPlatformCoinInventory({scope:A,accountId:A.account.id,direction:'ADD',amount:100,reason:'QA cannot generate currency',idempotencyKey:randomUUID()}),/Only the Master/);
  await assert.rejects(ops.updateRoomStatus({scope:A,roomId:randomUUID(),status:'ENDED',reason:'QA unauthorized room update'}),/scope/);
  assert.equal((await ops.listWithdrawalsPage(A)).items.length,0);await dir.hierarchy(A);await catalog.listSupportTickets(A);await monitor.listModerationHistory(A,[people.own.id,people.foreignCountry.id]);await payouts.listHostPayouts({account:A.account});
  const codes:Record<string,string>={};
  for(const [key,person] of Object.entries(people)){
    const code='QA-GM-'+key;codes[key]=code;
    await root.execute("INSERT INTO ledger_transactions(id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,source_id,destination_type,destination_id,amount,status,actor_account_id) VALUES(?,?,?,'COIN','QA_SCOPE_TRANSFER','PLATFORM_ACCOUNT',?,'APPLICATION_USER',?,100,'COMPLETED',?)",[randomUUID(),code,randomUUID(),A.account.id,person.id,A.account.id]);
  }
  const ledger=await dash.getRecentLedger(A,100);assert.deepEqual(ledger.map(r=>r.transactionCode),[codes.own]);
  const exported=await (await import('@/lib/db/repositories/ledger-export')).ledgerExportPage(A);assert.deepEqual(exported.map(r=>String(r.transaction_code)),[codes.own]);
  groups.push('Financial counterparties and CSV rows exclude foreign-team and wrong-country recipients');
  const scopedCS=await create('MONITORING_CS',ca,'SA','QA Restricted CS');
  const scopedSeller=await create('COIN_SELLER',ca,'SA','QA Restricted Seller');
  assert.equal(scopedCS.globalManagerId,A.account.id);assert.equal(scopedSeller.globalManagerId,A.account.id);
  assert.equal((await monitor.searchMonitoring(scopedCS,people.sameCountryForeignTeam.publicId)).length,0);
  assert.equal((await monitor.searchMonitoring(scopedCS,people.foreignCountry.publicId)).length,0);
  assert.equal((await dir.searchCoinTransferRecipients(scopedSeller,people.sameCountryForeignTeam.publicId)).length,0);
  assert.equal((await dir.searchCoinTransferRecipients(scopedSeller,people.own.publicId)).length,1);
  const childCountry=await accounts.scopeFor(ca.account);assert.equal((await dir.listUsersPage(childCountry)).items.some(u=>u.id===people.wrongCountrySameTeam.id),false);
  await (await import('@/lib/db/repositories/withdrawal-finance')).withdrawalFinance(childCountry);
  await (await import('@/lib/db/repositories/safety-moderation')).listSafetyReports(scopedCS,{status:'NEW',page:1});
  groups.push('Child CS / Coin Seller credentials inherit manager boundary; legacy-role escape denied');
  const rule=await (await import('@/lib/db/repositories/host-payout-rule')).loadHostPayoutRule();
  for(const [key,person] of Object.entries(people)){
    await root.execute("UPDATE wallet_balances SET available_balance=? WHERE owner_id=? AND asset_type='DIAMOND'",[rule.slabDiamonds,person.id]);
    const method=await payouts.saveHostPayoutAccount(person.id,{type:'BANK',displayName:'Fictitious QA beneficiary',destination:'TEST-ONLY-1234567890'});
    const input={amount:rule.slabDiamonds,payoutMethodId:method.id,idempotencyKey:randomUUID()};
    const first=await payouts.requestHostPayout(person.id,input),retry=await payouts.requestHostPayout(person.id,input);assert.equal(first.id,retry.id);
    const [[wallet]]=await root.query<RowDataPacket[]>("SELECT available_balance n FROM wallet_balances WHERE owner_id=? AND asset_type='DIAMOND'",[person.id]);assert.equal(Number(wallet.n),0);
  }
  const ownPayouts=await payouts.listHostPayouts({account:A.account}),foreignPayouts=await payouts.listHostPayouts({account:B.account});
  assert.equal(ownPayouts.length,1);assert.equal(String(ownPayouts[0].hostPublicId),people.own.publicId);assert.equal(foreignPayouts.length,2);
  const finance=await (await import('@/lib/db/repositories/withdrawal-finance')).withdrawalFinance(childCountry,aa.account.id);assert.equal(finance.hosts.length,1);assert.equal(finance.hosts[0].publicId,people.own.publicId);
  const parent=(await accounts.accountById(aa.account.id))!.parentAccountId!;
  await assert.rejects(admin.createPlatformAccount({scope:A,role:'AGENCY',fullName:'QA unauthorized owner link',countryCode:'SA',password:'Local-QA-Only-2026!',requestedParentId:parent,applicationUserId:people.sameCountryForeignTeam.id,documents:[]}),/authorized country\/team/);
  groups.push('Actual local payout requests: one Diamond debit per retry, scoped snapshots, no foreign owner linking');


  groups.push('Users / Hosts / monitoring / games / reports / exports / hierarchy / wallet country AND team filters / mint denied');
  await gm.saveCountryGroup(master,{id:middle.id,name:middle.name,active:true,countries:middle.countries.filter(c=>c!=='SA'),expectedVersion:middle.version,reason:'QA revoke Saudi Arabia dynamically'});
  A=await accounts.scopeFor(ga.account);assert(!A.countryCodes?.includes('SA'));assert.equal((await dir.listUsersPage(A)).items.length,0);
  await gm.saveCountryGroup(master,{id:middle.id,name:middle.name,active:true,countries:middle.countries,expectedVersion:middle.version+1,reason:'QA restore tested country membership'});
  A=await accounts.scopeFor(ga.account);assert.equal((await dir.listUsersPage(A)).items.length,1);
  await gm.saveGlobalManager(master,{id:ga.account.id,name:'QA Global A',status:'ACTIVE',countries:[],groups:[middle.id],countryManagers:[ca.account.id],gamesEnabled:false,expectedVersion:1,reason:'QA disable only scoped game reports'});
  await assert.rejects(reports.gameManagementReport(await accounts.scopeFor(ga.account)),/not authorized/);
  await gm.saveGlobalManager(master,{id:ga.account.id,name:'QA Global A',status:'ACTIVE',countries:[],groups:[middle.id],countryManagers:[ca.account.id],gamesEnabled:true,expectedVersion:2,reason:'QA restore scoped game reports'});
  const [audits]=await root.query<RowDataPacket[]>("SELECT action FROM audit_logs WHERE module='global_management'");assert(audits.length>=7);
  groups.push('Dynamic country removal/restoration / delegated game reports / immutable audited scope changes');
  // A successful seed migration replay must not silently undo an owner's subsequent country-group edit.
  await root.execute('DELETE FROM country_group_countries WHERE group_id=? AND country_code=?',[middle.id,'CY']);await root.query(await readFile('db/migrations/0117_global_manager_country_groups.sql','utf8'));
  const [[count]]=await root.query<RowDataPacket[]>('SELECT COUNT(*) n FROM country_group_countries WHERE group_id=?',[middle.id]);assert.equal(Number(count.n),16);
  await root.execute('INSERT INTO country_group_countries(group_id,country_code) VALUES(?,?)',[middle.id,'CY']);
  groups.push('Additive migration replay preserves owner-edited group membership');
  if(process.env.NAZRAA_GM_KEEP==='1'){
   keep=true;await writeFile('/tmp/nazraa-gm-qa-fixtures.json',JSON.stringify({database,master:master.account,A:ga.account,B:gb.account,people,DOCUMENT_ENCRYPTION_KEY:process.env.DOCUMENT_ENCRYPTION_KEY,SESSION_SECRET:randomBytes(40).toString('hex')}),{mode:0o600});
  }
  console.log(JSON.stringify({status:'PASS',groups,checks:'real isolated MySQL repository calls',middleEastCountries:17,productionDataModified:false,fixtureKept:keep}));
 }finally{await pool.end();global.nazraaPool=undefined;if(!keep)await root.query(`DROP DATABASE \`${database}\``);await root.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
