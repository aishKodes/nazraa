import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {registerHooks} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import mysql from 'mysql2/promise';
import {SignJWT} from 'jose';
import type {Scope,Role} from '@/types/platform';
registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});

async function main(){
  const database=`nazraa_country_http_${Date.now()}`,dbUser=`qa_${randomBytes(6).toString('hex')}`,password=randomBytes(24).toString('hex'),secret=randomBytes(32).toString('hex');
  const root=await mysql.createConnection({host:'127.0.0.1',user:'root',multipleStatements:true});
  let server:ReturnType<typeof spawn>|undefined;
  try{
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);await root.query(`USE \`${database}\``);
    for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())await root.query(await readFile('db/migrations/'+file,'utf8'));
    await root.query(`CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY '${password}'`);await root.query(`GRANT ALL ON \`${database}\`.* TO '${dbUser}'@'localhost'`);
    global.nazraaPool=mysql.createPool({host:'127.0.0.1',user:'root',database,timezone:'Z',connectionLimit:4});global.nazraaInstrumentedPool=global.nazraaPool;
    const a=await import('@/lib/db/repositories/accounts'),admin=await import('@/lib/db/repositories/administration');
    await a.createInitialMaster({publicId:100001,fullName:'Local QA Master',password:process.env.NAZRAA_QA_PREVIEW_SECONDS?'Country-Economy-Local-QA-2026!':randomBytes(20).toString('hex')});
    const master=await a.scopeFor((await a.accountByManagementId('100001'))!),scopes=new Map<Role,Scope>([['MASTER',master]]);
    async function create(role:Role,parent:Scope,countryCode='NG'){
      const r=await admin.createPlatformAccount({scope:master,role,requestedParentId:parent.account.id,countryCode,fullName:'Local QA '+role,password:randomBytes(20).toString('hex'),documents:[]});
      const scope=await a.scopeFor((await a.accountByManagementId(String(r.publicId)))!);scopes.set(role,scope);return scope;
    }
    const cm=await create('COUNTRY_MANAGER',master),sa=await create('SUPER_ADMIN',cm),adm=await create('ADMIN',sa);
    await create('BD',sa);await create('AGENCY',adm);await create('MONITORING_CS',adm);await create('COIN_SELLER',adm);
    server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3996'],{env:{...process.env,NODE_ENV:'production',DB_HOST:'127.0.0.1',DB_NAME:database,DB_USER:dbUser,DB_PASSWORD:password,DB_PORT:'3306',SESSION_SECRET:secret,DB_SSL:'false',REDIS_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NAZRAA_CUTOVER_FREEZE:'0'},stdio:'ignore'});
    const base='http://127.0.0.1:3996';
    for(let i=0;i<80;i++){if((await fetch(base+'/api/internal/health').catch(()=>null))?.ok)break;await new Promise(r=>setTimeout(r,100));}
    async function get(path:string,scope?:Scope){const token=scope?await new SignJWT(scope.account).setProtectedHeader({alg:'HS256'}).setExpirationTime('10m').sign(new TextEncoder().encode(secret)):'';return fetch(base+path,{headers:token?{cookie:'nazraa_control_session='+token}:{},redirect:'manual'});}
    assert.equal((await get('/api/countries')).status,401);assert.equal((await get('/api/games/economy')).status,401);
    for(const [role,scope] of scopes){
      assert.equal((await get('/api/games/economy',scope)).status,role==='MASTER'?200:403,role+' direct global economy API');
      const own=await get('/api/countries?country=NG',scope);assert.equal(own.status,['MASTER','COUNTRY_MANAGER'].includes(role)?200:403,role+' country API');
      assert.equal((await get('/api/countries?country=MA',scope)).status,role==='MASTER'?200:403,role+' cross-country API');
      if(role==='COUNTRY_MANAGER'){const d=await own.json();assert.deepEqual(d.countries.map((c:{code:string})=>c.code),['NG']);}
      for(const path of ['/dashboard/countries','/dashboard/game-management/economy']){
        const response=await get(path,scope),html=await response.text();
        const allowed=path.endsWith('countries')?['MASTER','COUNTRY_MANAGER'].includes(role):role==='MASTER';
        if(allowed){assert.equal(response.status,200);assert(!html.includes('Application error'));assert(html.includes(path.endsWith('countries')?'Country Management':'Game Economy / RTP'));}
        else assert(response.headers.get('location')?.includes('forbidden')||html.includes('/dashboard?error=forbidden'),role+' direct page denied');
      }
    }
    console.log('PASS direct production-build HTTP: anonymous 401; Master country/economy 200; Nigeria CM own-country 200/Morocco 403; all six other roles denied country API; all seven non-Master roles economy API 403; matching direct-page enforcement.');
    const seconds=Math.min(1800,Number(process.env.NAZRAA_QA_PREVIEW_SECONDS??0));
    if(seconds>0){console.log('LOCAL_QA_PREVIEW_READY http://127.0.0.1:3996/login');await new Promise<void>(resolve=>{const timer=setTimeout(resolve,seconds*1000);process.once('SIGUSR1',()=>{clearTimeout(timer);resolve();});});}
  }finally{
    if(server){server.kill('SIGTERM');await new Promise<void>(r=>server!.once('exit',()=>r()));}
    await global.nazraaPool?.end();global.nazraaPool=undefined;global.nazraaInstrumentedPool=undefined;
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``);await root.query(`DROP USER IF EXISTS '${dbUser}'@'localhost'`);await root.end();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
