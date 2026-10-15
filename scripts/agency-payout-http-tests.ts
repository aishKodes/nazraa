import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { SignJWT } from 'jose';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { SessionAccount } from '@/types/platform';

/** Built Next route tests against the disposable core QA database only. */
export async function verifyAgencyPayoutHttp(root:Connection,master:SessionAccount,agency:SessionAccount,foreignAgency:SessionAccount) {
  const [db]=await root.query<RowDataPacket[]>('SELECT DATABASE() name');
  assert.match(String(db[0].name),/^nazraa_mobile_qa_\d+$/);
  const secret=randomBytes(48).toString('hex'),url='http://127.0.0.1:3997';
  const dbUser='qa_'+randomBytes(6).toString('hex'),dbPassword=randomBytes(24).toString('hex');
  await root.query(`CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}'`);
  await root.query(`GRANT ALL ON \`${db[0].name}\`.* TO '${dbUser}'@'localhost'`);
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3997'],{
    env:{...process.env,NODE_ENV:'production',DB_HOST:'127.0.0.1',DB_USER:dbUser,DB_PASSWORD:dbPassword,DB_NAME:String(db[0].name),DB_PORT:'3306',DB_SSL:'false',SESSION_SECRET:secret,REDIS_URL:'',NAZRAA_CUTOVER_FREEZE:'0'},stdio:'ignore',
  });
  try {
    let ready=false;
    for(let i=0;i<100;i++){
      if((await fetch(url+'/api/internal/health').catch(()=>null))?.ok){ready=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,'Local built QA server must become healthy');
    async function request(account:SessionAccount|undefined,path='',body?:unknown,origin='https://nazralive.in'){
      const token=account?await new SignJWT(account as unknown as Record<string,unknown>).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret)):'';
      return fetch(url+'/api/host-payout-management'+path,{method:body?'POST':'GET',headers:{cookie:token?'nazraa_control_session='+token:'',origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    }
    assert.equal((await request(undefined)).status,401);
    const masterResponse=await request(master);assert.equal(masterResponse.status,200);
    const overview=await masterResponse.json();assert.deepEqual(overview.rows,[]);
    const group=overview.groups.find((g:{agencyKey:string})=>g.agencyKey===agency.id);
    assert.equal(Number(group.requestCount),11);assert.equal(Number(group.hostUsd),112);
    const detail=await request(master,'?agencyGroup='+agency.id);assert.equal(detail.status,200);
    const payload=await detail.json();assert.equal(payload.rows.length,11);assert.equal(payload.candidates.paid.ids.length,7);
    const own=await request(agency);assert.equal(own.status,200);assert.equal((await own.json()).rows.length,11);
    const foreign=await request(foreignAgency,'?agencyGroup='+agency.id);assert.equal(foreign.status,200);assert.deepEqual((await foreign.json()).rows,[]);
    assert.equal((await request(agency,'',{action:'rule'})).status,403);
    assert.equal((await request(master,'',{action:'agency-batch',kind:'paid',agencyGroup:agency.id,ids:payload.candidates.paid.ids,reference:'QA HTTP denied',reason:'QA confirmation is mandatory',confirmed:false})).status,400);
    assert.equal((await request(master,'',{action:'rule'},'https://untrusted.example')).status,400);
    console.log('PASS built payout HTTP: Master default Agency-only response, exact 11 saved details, Agency-only scope, foreign Agency denial, authentication/origin protection and explicit batch confirmation. No HTTP financial mutation was executed.');
  } finally {server.kill('SIGTERM');await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',()=>resolve());setTimeout(()=>{server.kill('SIGKILL');resolve();},3000).unref();}});await root.query(`DROP USER IF EXISTS '${dbUser}'@'localhost'`);}
}
