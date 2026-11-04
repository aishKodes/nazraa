import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SignJWT} from 'jose';
import ExcelJS from 'exceljs';
async function main(){
 const q=JSON.parse(await readFile('/tmp/nazraa-gm-qa-fixtures.json','utf8'));assert.match(q.database,/^nazraa_gm_qa_\d+$/);const base='http://127.0.0.1:3905';
 const jwt=async(account:any,forge=false)=>new SignJWT({...account,...(forge?{role:'MASTER'}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(q.SESSION_SECRET));
 const cookies={A:await jwt(q.A),B:await jwt(q.B),master:await jwt(q.master),forged:await jwt(q.A,true)};
 async function get(who:keyof typeof cookies,path:string){return fetch(base+path,{headers:{Cookie:'nazraa_control_session='+cookies[who]},redirect:'manual'});}
 const paths=['/dashboard','/dashboard/hierarchy','/dashboard/accounts','/dashboard/users','/dashboard/hosts','/dashboard/agencies','/dashboard/wallet','/dashboard/commerce','/dashboard/transactions','/dashboard/coin-transfers','/dashboard/withdrawals','/dashboard/monitoring','/dashboard/rooms','/dashboard/face-verification','/dashboard/risk','/dashboard/support','/dashboard/agency-report','/dashboard/hierarchy-report','/dashboard/live-rewards','/dashboard/game-management'];
 const passed=[];
 for(const path of paths){const r=await get('A',path);assert.equal(r.status,200,path+' HTTP');const html=await r.text();assert(!html.includes('Internal Server Error'),path);if(path==='/dashboard'){
  const nav=html.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1];assert(nav);const links=[...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);assert.equal(links.length,18);for(const label of ['Overview','Hierarchy Team','Users','Hosts','Agencies','Wallet &amp; Coins','Coin Orders &amp; Transactions','Coin Transfer History','Withdrawals &amp; Payouts','Monitoring','Live Rooms','Verification','Risks &amp; Restrictions','Support &amp; Reports','Agency Reports','Hiring Reports','Live Reports','Games Management'])assert(nav.includes(label),'Menu label '+label);assert.equal(links.at(-1),'/dashboard/game-management');for(const deny of ['/dashboard/gifts','/dashboard/banners','/dashboard/levels','/dashboard/settings','/dashboard/audit'])assert(!links.includes(deny));
 }passed.push(path);}
 for(const path of ['/dashboard/global-managers','/dashboard/gifts','/dashboard/banners','/dashboard/levels','/dashboard/settings','/dashboard/notifications','/dashboard/audit','/dashboard/game-management/economy']){const r=await get('A',path);const body=await r.text();assert(r.headers.get('location')?.includes('forbidden')||(r.status===200&&body.includes('/dashboard?error=forbidden')),path+' denies protected route before module data');}
 const denied=await get('forged','/dashboard/game-management/economy');assert(denied.headers.get('location')?.includes('forbidden')||(denied.status===200&&(await denied.text()).includes('/dashboard?error=forbidden')),'Signed token stale/forged role cannot override actual account role');
 const own=await (await get('A','/api/reports/games')).json();assert.equal(own.items.length,1);assert.equal(own.items[0].userId,q.people.own.publicId);
 for(const key of ['sameCountryForeignTeam','foreignCountry','wrongCountrySameTeam']){
  const data=await (await get('A','/api/reports/games?q='+q.people[key].publicId)).json();assert.equal(data.items.length,0,'Direct search '+key);
 }
 const exportResult=await get('A','/api/reports/agency-hosts?format=xlsx');assert.equal(exportResult.status,200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await exportResult.arrayBuffer()) as any);const values=workbook.worksheets[0].getSheetValues();const content=JSON.stringify(values);assert(content.includes('QA own'));for(const key of ['sameCountryForeignTeam','foreignCountry','wrongCountrySameTeam'])assert(!content.includes('QA '+key),'Export cannot leak '+key);
 const b=await (await get('B','/api/reports/games')).json();assert.equal(b.items.length,2);assert(!JSON.stringify(b).includes(q.people.own.publicId));
 const mutation=await fetch(base+'/api/host-payout-management',{method:'POST',headers:{Cookie:'nazraa_control_session='+cookies.A,'Content-Type':'application/json',Origin:base},body:JSON.stringify({action:'paid'})});assert.equal(mutation.status,403);
 const payout=await get('A','/api/host-payout-management');assert.equal(payout.status,200);const payment=await payout.json();assert.equal(payment.isMaster,false);
 const master=await get('master','/dashboard/global-managers');assert.equal(master.status,200);assert((await master.text()).includes('Middle East'));
 console.log(JSON.stringify({status:'PASS',pages:passed,menuCount:18,gamesLast:true,directRoutesDenied:true,apiSearchScoped:true,exportXlsxScoped:true,teamACannotSeeB:true,teamBCannotSeeA:true,tokenRoleCannotEscalate:true,masterOnlyPaymentEnforced:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
