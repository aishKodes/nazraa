import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {SignJWT} from 'jose';

async function main() {
  const database=process.env.NAZRAA_QA_DATABASE??'';
  assert.match(database,/^nazraa_control_qa_\d+$/,'Only the isolated local Control fixture may be used.');
  const root=await mysql.createConnection({host:'127.0.0.1',user:'root',database});
  const dbUser='qa_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex'),secret=randomBytes(48).toString('hex');
  await root.query(`CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY '${password}'`);
  await root.query(`GRANT ALL ON \`${database}\`.* TO '${dbUser}'@'localhost'`);
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3996'],{env:{...process.env,NODE_ENV:'production',DB_HOST:'127.0.0.1',DB_NAME:database,DB_USER:dbUser,DB_PASSWORD:password,DB_PORT:'3306',DB_SSL:'false',SESSION_SECRET:secret,REDIS_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NAZRAA_CUTOVER_FREEZE:'0'},stdio:'ignore'});
  try {
    const url='http://127.0.0.1:3996';let ready=false;
    for(let i=0;i<100;i++) {if((await fetch(url+'/api/internal/health').catch(()=>null))?.ok){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(ready,'Built Next QA server must be healthy');
    const [accounts]=await root.query<RowDataPacket[]>("SELECT id,public_id,role,full_name FROM platform_accounts WHERE removed_at IS NULL AND role<>'COIN_SELLER' UNION ALL SELECT id,public_id,role,full_name FROM platform_accounts WHERE removed_at IS NULL AND role='COIN_SELLER'");
    const master=accounts.find(a=>a.role==='MASTER')!;
    const [users]=await root.query<RowDataPacket[]>("SELECT id,public_id FROM application_users WHERE full_name='QA Finance Host'");const target=users[0];
    const [wallet]=await root.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[target.id]);const before=Number(wallet[0].available_balance);
    async function cookie(account?:RowDataPacket) {return account?'nazraa_control_session='+await new SignJWT({id:account.id,publicId:String(account.public_id),role:account.role,fullName:account.full_name}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(secret)):'';}
    const payload={userId:target.id,asset:'COIN',action:'ADD',amount:100,expectedBalance:before,reason:'Isolated HTTP retry regression',internalNote:'Not in mobile response',confirmed:true,idempotencyKey:randomUUID()};
    async function post(account?:RowDataPacket,body:unknown=payload,origin='https://nazralive.in') {return fetch(url+'/api/control/wallet-adjustments',{method:'POST',headers:{cookie:await cookie(account),'Content-Type':'application/json',origin},body:JSON.stringify(body)});}
    assert.equal((await post()).status,401);
    for(const account of accounts)if(account.role!=='MASTER')assert.equal((await post(account)).status,403,`${account.role} direct financial API must deny`);
    assert.equal((await post(master,payload,'https://untrusted.example')).status,403);
    assert.equal((await post(master,{...payload,confirmed:false})).status,400);
    const replies=await Promise.all(Array.from({length:20},async()=>{const response=await post(master);assert.equal(response.status,200,await response.clone().text());return response.json();}));
    assert.equal(new Set(replies.map(r=>r.result.id)).size,1);
    const [after]=await root.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='COIN'",[target.id]);assert.equal(Number(after[0].available_balance),before+100);
    assert.equal((await post(master,{...payload,amount:200})).status,409);
    for(const role of ['COUNTRY_MANAGER','MONITORING_CS','AGENCY','ADMIN']) {
      const denied=await fetch(url+'/dashboard/wallet/adjustments?q='+target.public_id,{headers:{cookie:await cookie(accounts.find(a=>a.role===role))},redirect:'manual'});const html=await denied.text();
      assert.ok(denied.headers.get('location')?.includes('forbidden')||html.includes('/dashboard?error=forbidden'));
      assert.ok(!html.includes('Not in mobile response'),'Unauthorized page cannot leak adjustment history');
    }
    const masterPage=await fetch(url+'/dashboard/wallet/adjustments?q='+target.public_id,{headers:{cookie:await cookie(master)}});assert.equal(masterPage.status,200);assert.match(await masterPage.text(),/QA Finance Host/);
    const cs=accounts.find(a=>a.role==='MONITORING_CS')!;
    const csPage=await fetch(url+'/dashboard/monitoring?q='+target.public_id,{headers:{cookie:await cookie(cs)}});const csHtml=await csPage.text();
    assert.equal(csPage.status,200);assert.match(csHtml,/QA Finance Host/);assert.ok(!csHtml.includes('qa-finance@example.invalid'));assert.ok(!csHtml.includes('+910000000001'));
    console.log('PASS HTTP: anonymous 401; every non-Master role 403; cross-origin 403; unconfirmed 400; 20 parallel same-key requests create one +100 credit; changed-key payload 409; restricted pages deny; CS HTML excludes contacts.');
    if(process.env.NAZRAA_QA_UI==='1') {
      console.log('QA_UI_READY http://127.0.0.1:3996 — isolated fixture, normal test account login only.');
      await new Promise<void>(resolve=>{process.once('SIGTERM',()=>resolve());process.once('SIGINT',()=>resolve());});
    }
  } finally {
    server.kill('SIGTERM');await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',()=>resolve());setTimeout(()=>{server.kill('SIGKILL');resolve();},3000).unref();}});
    await root.query(`DROP USER IF EXISTS '${dbUser}'@'localhost'`);await root.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
