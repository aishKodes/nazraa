import {getSession} from '@/lib/auth/session';
import {scopeFor} from '@/lib/db/repositories/accounts';
import {gameEconomyDashboard} from '@/lib/db/repositories/game-economy';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const account=await getSession();if(!account)return Response.json({error:'Sign in required.'},{status:401});
  if(account.role!=='MASTER')return Response.json({error:'Forbidden.'},{status:403});
  const p=new URL(request.url).searchParams;
  try{return Response.json(await gameEconomyDashboard(await scopeFor(account),p.get('period')??'today',p.get('from')??undefined,p.get('to')??undefined),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Game economy data is unavailable. Check the date range or retry.'},{status:400});}
}
