import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import type {SessionAccount} from '@/types/platform';
import * as payout from '@/lib/db/repositories/host-payouts';
import {agencyPayoutGroups,agencyPayoutCandidates} from '@/lib/db/repositories/agency-payout-groups';
import {loadHostPayoutRule,decimalUsd,multiplyPayoutUsd} from '@/lib/db/repositories/host-payout-rule';
import {saveWithdrawalEconomy} from '@/lib/db/repositories/mobile-administration';
import {defaultWithdrawalEconomy} from '@/lib/db/repositories/withdrawal-economy';
import {verifyAgencyPayoutHttp} from './agency-payout-http-tests';
import {hostPayoutCsv,payoutCsvCell} from '@/lib/reports/host-payout-csv';

export async function verifyAgencyPayoutOwnerRequirements(root:Connection,user:(name:string)=>Promise<MobileIdentity>,master:SessionAccount,existingAgency:SessionAccount){
  const agencyId=randomUUID();let publicId=999999;
  for(;;){const [rows]=await root.query<RowDataPacket[]>('SELECT id FROM platform_accounts WHERE public_id=?',[publicId]);if(!rows.length)break;publicId--;}
  await root.execute(`INSERT INTO platform_accounts(id,public_id,role,role_code,full_name,password_hash,status,parent_account_id,country_code,created_by)
    SELECT ?,?,'AGENCY',?,'QA ten Host payout Agency',password_hash,'ACTIVE',parent_account_id,'IN',? FROM platform_accounts WHERE id=?`,
    [agencyId,publicId,`QA${randomUUID().slice(0,12)}`,master.id,existingAgency.id]);
  const agency={...existingAgency,id:agencyId,publicId:String(publicId)};
  const basis=await loadHostPayoutRule();
  await payout.saveHostPayoutRule(master,{slabDiamonds:125000,totalUsd:basis.totalUsd,hostUsd:'10.00',agencyUsd:'1.10',reason:'QA owner baseline: future snapshots only'});
  await assert.rejects(saveWithdrawalEconomy({scope:{account:master} as never,reason:'QA stale old settings submission',value:defaultWithdrawalEconomy}),/Use Host payout rules/);
  assert.equal((await loadHostPayoutRule()).slabDiamonds,125000);
  const entries:{host:MobileIdentity;method:string;id:string}[]=[];
  for(let i=0;i<10;i++){
    const host=await user(`QA group Host ${i+1}`);
    await root.execute('UPDATE application_users SET agency_account_id=? WHERE id=?',[agencyId,host.userId]);
    await root.execute('UPDATE host_profiles SET agency_account_id=? WHERE application_user_id=?',[agencyId,host.userId]);
    await root.execute("INSERT INTO wallet_balances(id,owner_type,owner_id,asset_type,available_balance) VALUES(?,'APPLICATION_USER',?,'DIAMOND',250000)",[randomUUID(),host.userId]);
    const method=await payout.saveHostPayoutAccount(host.userId,{type:'UPI',displayName:`QA Host ${i+1}`,destination:`qa-group-${i}@bank`});
    const input={amount:125000,payoutMethodId:method.id,idempotencyKey:randomUUID()};
    const retries=await Promise.all(Array.from({length:i===0?8:1},()=>payout.requestHostPayout(host.userId,input)));
    assert.equal(new Set(retries.map(r=>r.id)).size,1);
    const row=(await payout.listHostPayouts({userId:host.userId}))[0];
    assert.equal(decimalUsd(row.hostUsd),'10.00');assert.equal(decimalUsd(row.agencyUsd),'1.10');
    entries.push({host,method:method.id,id:retries[0].id});
  }
  const filters={agencyGroup:agencyId};
  let groups=await agencyPayoutGroups(master,filters);
  assert.equal(groups.groups.length,1);
  const g=groups.groups[0];
  assert.deepEqual([Number(g.requestCount),Number(g.hostCount),Number(g.diamonds),decimalUsd(g.hostUsd),decimalUsd(g.agencyUsd),decimalUsd(g.pendingUsd)],[10,10,1250000,'100.00','11.00','100.00']);
  assert.equal((await payout.listHostPayouts({account:agency})).length,10);
  assert.equal((await payout.listHostPayouts({account:existingAgency},{agencyGroup:agencyId})).length,0);
  await assert.rejects(agencyPayoutGroups(agency),/Only Master/);
  const candidates=await agencyPayoutCandidates(master,filters);
  assert.equal(candidates.paid.ids.length,10);assert.equal(candidates.paid.hostUsd,'100.00');assert.equal(candidates.paid.agencyUsd,'11.00');
  const batch={agencyGroup:agencyId,ids:entries.slice(0,4).map(e=>e.id),action:'paid' as const,reference:'QA-GROUP-HOST-001',reason:'QA record four provider payments'};
  await assert.rejects(payout.manageAgencyPayoutBatch(agency,batch),/Only Master/);
  await assert.rejects(payout.manageAgencyPayoutBatch(master,{...batch,agencyGroup:existingAgency.id}),/do not all belong/);
  const results=await Promise.all([payout.manageAgencyPayoutBatch(master,batch),payout.manageAgencyPayoutBatch(master,batch)]);
  assert.equal(results.reduce((sum,r)=>sum+r.updated,0),4);
  groups=await agencyPayoutGroups(master,filters);
  assert.deepEqual([decimalUsd(groups.groups[0].paidUsd),decimalUsd(groups.groups[0].pendingUsd),Number(groups.groups[0].paidCount),Number(groups.groups[0].pendingCount)],['40.00','60.00',4,6]);
  const commissionBatch={...batch,action:'agency-paid' as const,reference:'QA-GROUP-AGENCY-001'};
  await payout.manageAgencyPayoutBatch(master,commissionBatch);await payout.manageAgencyPayoutBatch(master,commissionBatch);
  groups=await agencyPayoutGroups(master,filters);
  assert.equal(decimalUsd(groups.groups[0].agencyPaidUsd),'4.40');assert.equal(decimalUsd(groups.groups[0].agencyPendingUsd),'6.60');
  const [before]=await root.query<RowDataPacket[]>('SELECT withdrawal_id,rule_snapshot,host_usd,agency_usd,agency_account_id FROM host_payout_snapshots WHERE agency_account_id=? ORDER BY withdrawal_id',[agencyId]);
  await payout.saveHostPayoutRule(master,{slabDiamonds:125000,totalUsd:'15.00',hostUsd:'12.00',agencyUsd:'2.00',reason:'QA new future rule; preserve ten old snapshots'});
  const [after]=await root.query<RowDataPacket[]>('SELECT withdrawal_id,rule_snapshot,host_usd,agency_usd,agency_account_id FROM host_payout_snapshots WHERE agency_account_id=? ORDER BY withdrawal_id',[agencyId]);
  assert.deepEqual(after,before,'Editing the rule never reprices existing snapshots');
  await payout.requestHostPayout(entries[0].host.userId,{amount:125000,payoutMethodId:entries[0].method,idempotencyKey:randomUUID()});
  const future=(await payout.listHostPayouts({userId:entries[0].host.userId}))[0];
  assert.equal(decimalUsd(future.hostUsd),'12.00');assert.equal(decimalUsd(future.agencyUsd),'2.00');
  await root.execute('UPDATE application_users SET agency_account_id=NULL WHERE id=?',[entries[1].host.userId]);
  assert.equal(Number((await agencyPayoutGroups(master,filters)).groups[0].requestCount),11,'Agency association snapshot survives a later membership change');
  const [duplicates]=await root.query<RowDataPacket[]>("SELECT idempotency_key,COUNT(*) n FROM ledger_transactions WHERE idempotency_key LIKE 'host-payout:%' GROUP BY idempotency_key HAVING COUNT(*)>1");
  assert.equal(duplicates.length,0);
  const [allocations]=await root.query<RowDataPacket[]>(`SELECT withdrawal_id FROM withdrawal_distribution_snapshots WHERE withdrawal_id IN (${entries.map(()=>'?').join(',')})`,entries.map(e=>e.id));
  assert.equal(allocations.length,0,'No automatic Admin/BD/CS or other-role allocations');
  assert.equal(multiplyPayoutUsd('1.10',10),'11.00');
  await assert.rejects(payout.saveHostPayoutRule(agency,{slabDiamonds:1,totalUsd:'15',hostUsd:'12',agencyUsd:'2',reason:'QA forbidden rate edit'}),/Only Master/);
  await verifyAgencyPayoutHttp(root,master,agency,existingAgency);
  // An Agency Owner is also a Host. Their own active Agency wins over a
  // stale membership, while requests already made keep their saved Agency.
  const owner=await user('QA dual-role Agency Owner Host');
  await root.execute('UPDATE application_users SET agency_account_id=? WHERE id=?',[existingAgency.id,owner.userId]);
  await root.execute('UPDATE platform_accounts SET application_user_id=? WHERE id=?',[owner.userId,agencyId]);
  await root.execute("INSERT INTO wallet_balances(id,owner_type,owner_id,asset_type,available_balance) VALUES(?,'APPLICATION_USER',?,'DIAMOND',35000000)",[randomUUID(),owner.userId]);
  const ownerMethod=await payout.saveHostPayoutAccount(owner.userId,{type:'UPI',displayName:'QA Owner Host',destination:'owner-private-test@bank'});
  const ownerRequest=await payout.requestHostPayout(owner.userId,{amount:125000,payoutMethodId:ownerMethod.id,idempotencyKey:randomUUID()});
  const ownerRows=await payout.listHostPayouts({account:agency},{search:String(owner.publicId)});
  assert.equal(ownerRows.length,1);assert.equal(ownerRows[0].id,ownerRequest.id);
  assert.equal(String(ownerRows[0].agencyPublicId),agency.publicId);
  assert.equal((await payout.listHostPayouts({account:existingAgency},{search:String(owner.publicId)})).length,0);
  // Page across 250 rows with equal server timestamps; no truncation/duplicates.
  // These are real idempotent QA ledger writes in the disposable database.
  for(let i=0;i<253;i++)await payout.requestHostPayout(owner.userId,{amount:125000,payoutMethodId:ownerMethod.id,idempotencyKey:randomUUID()});
  const exportRows=await payout.listHostPayouts({account:master},{search:String(owner.publicId)},1000);
  assert.equal(exportRows.length,254);
  const exported=await (await hostPayoutCsv(master,{search:String(owner.publicId)},'details')).text();
  const lines=exported.trim().split('\r\n');
  assert.equal(lines.length,255);assert.equal(new Set(lines.slice(1).map(line=>line.split(',')[0])).size,254);
  for(const row of exportRows)assert.ok(exported.includes(String(row.requestId)));
  assert.ok(!exported.includes('owner-private-test@bank'),'Export never decrypts private payment destinations');
  const aggregate=await (await hostPayoutCsv(master,{agencyGroup:agencyId},'agencies')).text();
  assert.equal(aggregate.trim().split('\r\n').length,2);assert.match(aggregate,/"265"/);
  await assert.rejects(hostPayoutCsv(agency,{},'agencies'),/Only Master/);
  const foreignCsv=await (await hostPayoutCsv(existingAgency,{agencyGroup:agencyId},'details')).text();
  assert.equal(foreignCsv.trim().split('\r\n').length,1);
  assert.equal(payoutCsvCell('  =SUM(1,2)'),`"'  =SUM(1,2)"`);
  assert.equal(payoutCsvCell('Name, "quoted"'),`"Name, ""quoted"""`);
  const savedOwnerSnapshot=(await root.query<RowDataPacket[]>('SELECT agency_account_id,host_usd,agency_usd,rule_snapshot FROM host_payout_snapshots WHERE withdrawal_id=?',[ownerRequest.id]))[0];
  await root.execute('UPDATE application_users SET agency_account_id=NULL WHERE id=?',[owner.userId]);
  assert.deepEqual((await root.query<RowDataPacket[]>('SELECT agency_account_id,host_usd,agency_usd,rule_snapshot FROM host_payout_snapshots WHERE withdrawal_id=?',[ownerRequest.id]))[0],savedOwnerSnapshot);
  console.log('PASS Owner Host payouts use own Agency, not stale membership; historical snapshots unchanged; 254-row cursor CSV complete/unique/masked; Master aggregate CSV, foreign-Agency scope and spreadsheet formula escaping.');
  console.log('PASS Agency-centric owner payouts: 10 real QA Hosts → 1.25M Diamonds / $100 Host / $11 Agency; one Master Agency row, scoped drill-down, decimal USD, 4 paid + 6 pending, atomic retry-safe Agency batches, immutable rate/Agency snapshots and no other-role allocations.');
}
