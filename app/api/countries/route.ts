import {getSession} from '@/lib/auth/session';
import {scopeFor} from '@/lib/db/repositories/accounts';
import {countryManagement,requireCountryAccess} from '@/lib/db/repositories/country-management';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const account=await getSession();
  if(!account)return Response.json({error:'Sign in required.'},{status:401});
  const scope=await scopeFor(account),country=new URL(request.url).searchParams.get('country')??undefined;
  try{requireCountryAccess(scope,country);}catch{return Response.json({error:'Country access denied.'},{status:403});}
  try{return Response.json(await countryManagement(scope,country),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Country data is temporarily unavailable.'},{status:503});}
}
