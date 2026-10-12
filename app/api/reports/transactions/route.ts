import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { ledgerExportPage } from "@/lib/db/repositories/ledger-export";
import {exportRowDate} from '@/lib/reports/xlsx';

export const dynamic = "force-dynamic";

function csvValue(value: unknown) {
  const content = (value==null?'':String(value)).replaceAll('"', '""');
  // Escape formula-like cells so an export cannot execute spreadsheet formulas when opened.
  const safe = /^[=+\-@\t\r]/.test(content) ? `'${content}` : content;
  return `"${safe}"`;
}

export async function GET() {
  const account = await getSession();
  if (!account)return new NextResponse('Sign in required',{status:401});
  if (!can(account.role, "reports.export")) return new NextResponse("Forbidden", { status: 403 });
  const scope=await scopeFor(account);
  const fields=['transaction_code','asset_type','transaction_type','source_type','source_public_id','source_name','source_agency_id','source_agency_name','destination_type','destination_public_id','destination_name','destination_agency_id','destination_agency_name','amount','money_amount','currency','payment_method','status','created_at','actor_public_id'];
  // Fetch the first authorized page before sending headers so initial errors
  // cannot produce a falsely successful download. Subsequent pages honor
  // stream backpressure; no 10,000-row silent truncation or full-ledger load.
  let rows=await ledgerExportPage(scope);let started=false;let done=false;
  const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller){
      if(done)return;
      try{
        if(!started){controller.enqueue(encoder.encode('\uFEFF'+fields.map(csvValue).join(',')+'\r\n'));started=true;}
        if(!rows.length){done=true;controller.close();return;}
        controller.enqueue(encoder.encode(rows.map(row=>fields.map(field=>csvValue(field==='created_at'?exportRowDate(row[field]):row[field])).join(',')).join('\r\n')+'\r\n'));
        if(rows.length<1000){done=true;controller.close();return;}
        const last=rows.at(-1)!; rows=await ledgerExportPage(scope,{createdAt:last.created_at as string|Date,id:String(last.id)});
      }catch{done=true;controller.error(new Error('The export was interrupted. Please retry.'));}
    },cancel(){done=true;rows=[];},
  });
  return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=nazraa-transactions.csv", "Cache-Control": "no-store" } });
}
