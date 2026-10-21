import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { Role, Scope } from '@/types/platform';
import { adjustUserBalance, searchAdjustmentTargets, listMasterAdjustments } from '@/lib/db/repositories/master-adjustments';
import type { MasterAdjustmentInput } from '@/lib/finance/master-adjustment';
import {formatDate} from '@/lib/utils/format';

/** Called only inside the isolated verify-control-integration fixture DB. */
export async function verifyMasterAllocation(root:Connection, scopes:Map<Role,Scope>) {
  const master=scopes.get('MASTER')!;
  const userIds:string[]=[];
  for(let index=0;index<26;index++) {
    const id=randomUUID();userIds.push(id);
    await root.execute(`INSERT INTO application_users (id,public_id,external_user_id,full_name,is_host,account_status,agency_account_id)
      VALUES (?,?,?,'QA Allocation Same Name',?,?,?)`,[id,88550000+index,`Alloc-${index}`,index%2===0,index===2?'SUSPENDED':'ACTIVE',index===4?scopes.get('AGENCY')!.account.id:null]);
    await root.execute("INSERT INTO wallet_balances (id,owner_type,owner_id,asset_type,available_balance) VALUES (?,'APPLICATION_USER',?,'COIN',1000)",[randomUUID(),id]);
  }
  const platform=scopes.get('ADMIN')!;
  await root.execute("INSERT IGNORE INTO wallet_balances (id,owner_type,owner_id,asset_type,available_balance) VALUES (?,'PLATFORM_ACCOUNT',?,'COIN',200)",[randomUUID(),platform.account.id]);
  const first=await searchAdjustmentTargets(master,' 88 55 ');
  assert.equal(first.items.length,20);assert.equal(first.hasNext,true);
  const second=await searchAdjustmentTargets(master,'8855',2);
  assert.equal(second.items.length,6);assert.equal(second.hasNext,false);
  assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,26);
  assert.equal((await searchAdjustmentTargets(master,'88550001')).items[0].id,userIds[1]);
  assert.equal((await searchAdjustmentTargets(master,' aLLoC-1 ')).items[0].id,userIds[1],'case-normalized exact Host ID precedes similar prefixes');
  assert.equal((await searchAdjustmentTargets(master,'00088550001')).items[0].id,userIds[1]);
  assert.equal((await searchAdjustmentTargets(master,'88550002')).items[0].status,'SUSPENDED');
  assert.equal((await searchAdjustmentTargets(master,'88550004')).items[0].agencyId,scopes.get('AGENCY')!.account.publicId);
  const platformMatch=(await searchAdjustmentTargets(master,platform.account.publicId)).items.find(item=>item.ownerType==='PLATFORM_ACCOUNT')!;
  assert.equal(platformMatch.id,platform.account.id);assert.equal(platformMatch.role,'ADMIN');
  assert.equal((await searchAdjustmentTargets(master,'QA Allocation Same Name')).items.length,0);
  assert.equal((await searchAdjustmentTargets(master,'__%')).items.length,0,'wildcards are literal, not match-all');
  const request=(overrides:Partial<MasterAdjustmentInput>={}):MasterAdjustmentInput=>({userId:userIds[0],ownerType:'APPLICATION_USER',asset:'COIN',action:'ADD',amount:100,expectedBalance:1000,reason:'QA allocation regression',internalNote:'',idempotencyKey:randomUUID(),confirmed:true,...overrides});
  const credit=request();
  const results=await Promise.all(Array.from({length:20},()=>adjustUserBalance(master,credit)));
  assert.equal(new Set(results.map(result=>result.id)).size,1);
  assert.equal((await searchAdjustmentTargets(master,'88550000')).items[0].coins,1100);
  const debit=await adjustUserBalance(master,request({action:'REMOVE',amount:50,expectedBalance:1100}));assert.equal(debit.after,1050);
  const diamond=await adjustUserBalance(master,request({asset:'DIAMOND',expectedBalance:0}));assert.equal(diamond.after,100);
  const diamondDebit=await adjustUserBalance(master,request({asset:'DIAMOND',action:'REMOVE',amount:50,expectedBalance:100}));assert.equal(diamondDebit.after,50);
  await assert.rejects(adjustUserBalance(master,request({action:'REMOVE',amount:1051,expectedBalance:1050})),/Insufficient Coin/);
  const platformCredit=request({userId:platform.account.id,ownerType:'PLATFORM_ACCOUNT',expectedBalance:200});
  await adjustUserBalance(master,platformCredit);
  assert.equal((await adjustUserBalance(master,platformCredit)).replayed,true);
  await adjustUserBalance(master,request({userId:platform.account.id,ownerType:'PLATFORM_ACCOUNT',action:'REMOVE',amount:50,expectedBalance:300}));
  await adjustUserBalance(master,request({userId:platform.account.id,ownerType:'PLATFORM_ACCOUNT',asset:'DIAMOND',expectedBalance:0}));
  await adjustUserBalance(master,request({userId:platform.account.id,ownerType:'PLATFORM_ACCOUNT',asset:'DIAMOND',action:'REMOVE',amount:50,expectedBalance:100}));
  const updated=(await searchAdjustmentTargets(master,platform.account.publicId)).items.find(item=>item.ownerType==='PLATFORM_ACCOUNT')!;
  assert.deepEqual([updated.coins,updated.diamonds],[250,50]);
  await assert.rejects(adjustUserBalance(master,{...platformCredit,ownerType:'APPLICATION_USER'}));
  for(const [role,scope] of scopes)if(role!=='MASTER') {
    await assert.rejects(searchAdjustmentTargets(scope,'8855'),{status:403});
    await assert.rejects(adjustUserBalance(scope,credit),{status:403});
    await assert.rejects(listMasterAdjustments(scope),{status:403});
  }
  assert.equal((await listMasterAdjustments(master,1,'88550000')).items.length,4);
  assert.equal((await listMasterAdjustments(master,1,credit.idempotencyKey)).items.length,0,'request ID is not a transaction ID');
  assert.equal((await listMasterAdjustments(master,1,debit.transactionCode)).items[0].id,debit.id);
  assert.equal((await listMasterAdjustments(master,1,debit.id)).items[0].id,debit.id);
  const platformHistory=await listMasterAdjustments(master,1,platform.account.publicId);
  assert.equal(platformHistory.items.length,4);assert.equal(platformHistory.items[0].ownerType,'PLATFORM_ACCOUNT');
  const [counts]=await root.query<RowDataPacket[]>("SELECT COUNT(*) entries FROM ledger_transactions WHERE transaction_type LIKE 'MASTER_%' AND (source_id=? OR destination_id=?)",[userIds[0],userIds[0]]);assert.equal(Number(counts[0].entries),4);
  assert.match(formatDate('2026-10-21 00:00:00'),/5:30/);
  const [explain]=await root.query<RowDataPacket[]>('EXPLAIN FORMAT=TRADITIONAL SELECT id FROM application_users FORCE INDEX (uq_application_user_public_id) WHERE public_id BETWEEN 88550000 AND 88559999');
  assert.equal(explain[0].key,'uq_application_user_public_id');assert.equal(explain[0].type,'range');
  console.log('PASS allocation: normal/Host/Agency-associated/suspended/platform wallet IDs; exact-first/case/space/prefix/20+6 pagination; eight app/platform operations; 20 concurrent retries once; overdraw/role denial; searchable transaction/target history; IST; public-ID range index.');
}
