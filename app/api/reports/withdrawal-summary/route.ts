import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { withdrawalSummary,type WithdrawalSummaryInput } from "@/lib/db/repositories/withdrawal-summary";
import { exportRowDate,workbookBuffer } from "@/lib/reports/xlsx";
export const dynamic='force-dynamic';
export const runtime='nodejs';
function csv(value:unknown) {
  let text=value==null?'':String(value);
  // Spreadsheet formula injection is not part of a read-only financial export.
  if(/^[=+@\-\t\r]/.test(text)) text="'"+text;
  return `"${text.replaceAll('"','""')}"`;
}
export async function GET(request:Request) {
  const account=await getSession();
  if(!account)return NextResponse.json({error:'Sign in required.'},{status:401});
  if(account.role!=='MASTER')return NextResponse.json({error:'Forbidden.'},{status:403});
  const params=new URL(request.url).searchParams;
  const input:WithdrawalSummaryInput=Object.fromEntries(['period','from','to','country','agency','status','q'].map(key=>[key,params.get(key)??undefined]));
  const kind=params.get('kind');const format=params.get('format');
  if(!['country','detail'].includes(kind??'')||!['csv','xlsx'].includes(format??''))return NextResponse.json({error:'Choose a valid export.'},{status:400});
  try {
    const data=await withdrawalSummary(await scopeFor(account),input,kind as 'country'|'detail',true);
    const fields=kind==='country'?['country','agencies','hosts','requests','processed_diamonds','processed_usd','host_payout_usd','agency_commission_usd','pending_requests','missing_distribution_snapshots']
      :['withdrawal_code','country','agency_public_id','agency_name','host_public_id','host_name','amount','status','payment_channel','requested_at','reviewed_at','completed_at','provider_reference','total_usd','host_usd','agency_usd','super_admin_usd','admin_usd','bd_usd','country_manager_usd','company_usd','usd_inr_rate'];
    const rows=data.items.map(row=>fields.map(field=>field.endsWith('_at')?exportRowDate(row[field] as string|null):row[field]==null?null:typeof row[field]==='number'?row[field] as number:String(row[field])));
    const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Disposition":`attachment; filename="nazraa-withdrawal-${kind}.${format}"`};
    if(format==='csv')return new Response('\uFEFF'+[fields,...rows].map(row=>row.map(csv).join(',')).join('\r\n'),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8'}});
    const bytes=await workbookBuffer('Nazraa Saved Withdrawal Snapshots',[{name:kind==='country'?'Country Summary':'Withdrawal Details',headers:fields,rows}]);
    return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const invalid=message.startsWith('Choose a valid'),large=message.startsWith('Filtered export exceeds');
    return NextResponse.json({error:invalid||large?message:'The report could not be generated. Please retry.'},{status:invalid?400:large?413:500});
  }
}
