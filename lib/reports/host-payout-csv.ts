import 'server-only';
import type {SessionAccount} from '@/types/platform';
import {agencyPayoutGroups} from '@/lib/db/repositories/agency-payout-groups';
import {listHostPayouts,PayoutError,type PayoutFilters} from '@/lib/db/repositories/host-payouts';
import {decimalUsd} from '@/lib/db/repositories/host-payout-rule';
import {db} from '@/lib/db/pool';
import type {RowDataPacket} from 'mysql2/promise';

export function payoutCsvCell(value:unknown) {
  let text=String(value??'');
  // Quotes alone do not prevent spreadsheet formulas, including padded ones.
  if(/^[\s\uFEFF]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function rowText(fields:string[],row:Record<string,unknown>) {
  return fields.map(key=>{
    let value=row[key];
    if(key.endsWith('At')) value=value?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'medium'}).format(new Date(value as string|Date))+' IST':'';
    else if(key.endsWith('Usd')) value=decimalUsd(value??0);
    return payoutCsvCell(value);
  }).join(',')+'\r\n';
}
const headers=(name:string)=>({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="nazraa-${name}-usd.csv"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});

/** Masked read-only ledger export; no decrypted payout destinations. */
export async function hostPayoutCsv(account:SessionAccount,filters:PayoutFilters,kind:'agencies'|'details') {
  if(!['MASTER','AGENCY'].includes(account.role)) throw new PayoutError('Your role cannot export payouts.');
  if(kind==='agencies') {
    if(account.role!=='MASTER') throw new PayoutError('Only Master may export the global Agency payout list.');
    const {groups}=await agencyPayoutGroups(account,filters,1,true);
    const fields=['agencyPublicId','agencyName','country','requestCount','hostCount','diamonds','hostUsd','agencyUsd','paidUsd','pendingUsd','paidCount','pendingCount','reversedCount','agencyAccruedUsd','agencyPaidUsd','agencyPendingUsd','latestRequestAt'];
    return new Response('\uFEFF'+fields.map(payoutCsvCell).join(',')+'\r\n'+groups.map(row=>rowText(fields,row)).join(''),{headers:headers('agency-payout-summary')});
  }
  const fields=['requestId','hostPublicId','hostName','agencyPublicId','agencyName','country','diamonds','hostUsd','agencyUsd',...(account.role==='MASTER'?['companyUsd']:[]),'status','requestedAt','approvedAt','paidAt','agencyPaidAt','payoutType','payoutAccount','paymentReference','agencyPaymentReference'];
  // Use the database clock, not the browser/API host clock, for the export's
  // upper boundary. All pages share it even while new requests arrive.
  const [clock]=await db().query<RowDataPacket[]>('SELECT CURRENT_TIMESTAMP(3) cutoff');
  const encoder=new TextEncoder(),cutoff=new Date(clock[0].cutoff);
  let cursor:{requestedAt:Date;id:string}|undefined,done=false,started=false;
  // Immutable (requested_at,id) cursor, not OFFSET or an invisible 10k cap.
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller){
      if(done)return;
      try {
        const rows=await listHostPayouts({account},filters,250,undefined,{cutoff,before:cursor});
        if(!started){controller.enqueue(encoder.encode('\uFEFF'+fields.map(payoutCsvCell).join(',')+'\r\n'));started=true;}
        if(rows.length) {
          controller.enqueue(encoder.encode(rows.map(row=>rowText(fields,row)).join('')));
          const last=rows.at(-1)!;
          cursor={requestedAt:new Date(last.requestedAt as string|Date),id:String(last.id)};
        }
        if(rows.length<250){done=true;controller.close();}
      }catch{done=true;controller.error(new Error('The payout export was interrupted. Please retry.'));}
    },
    cancel(){done=true;},
  });
  return new Response(stream,{headers:headers('host-payouts')});
}
