'use client';
import { useState } from 'react';
export type AgencyPayoutGroup = {
  agencyKey:string;agencyName:string|null;agencyPublicId:string|null;country:string;
  requestCount:number;hostCount:number;diamonds:number;hostUsd:string;agencyUsd:string;
  paidUsd:string;pendingUsd:string;paidCount:number;pendingCount:number;reversedCount:number;
  agencyAccruedUsd:string;agencyPaidUsd:string;agencyPendingUsd:string;latestRequestAt:string;
};
export type PaymentCandidates=Record<string,{ids:string[];hostUsd:string;agencyUsd:string;hasMore:boolean}>;
const dollars=(v:unknown)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v??0));
export function AgencyPayoutList({groups,onOpen}:{groups:AgencyPayoutGroup[];onOpen:(key:string)=>void}) {
  return <div className="panel scroll"><h2>Agency payout activity</h2><p>One row per saved Agency. Request totals include history; paid and awaiting payment are shown separately. Reversed/failed requests do not remain payable.</p>
    <table><thead><tr><th>Agency / Country</th><th>Requests / Hosts</th><th>Diamonds requested</th><th>Host payout</th><th>Agency commission</th><th>Host paid / Pending</th><th>Commission paid / Pending</th><th>Latest / Status</th><th>Workspace</th></tr></thead>
    <tbody>{groups.map(g=><tr key={g.agencyKey}>
      <td><b>{g.agencyName??'Independent Hosts'}</b><br/><small>{g.agencyPublicId??'No Agency'} · {g.country}</small></td>
      <td>{Number(g.requestCount).toLocaleString()} requests<br/><small>{Number(g.hostCount).toLocaleString()} Hosts</small></td>
      <td>{Number(g.diamonds).toLocaleString('en-IN')}</td><td>{dollars(g.hostUsd)}</td><td>{dollars(g.agencyAccruedUsd)}<br/><small>Requested: {dollars(g.agencyUsd)}</small></td>
      <td><b>{dollars(g.paidUsd)}</b> paid<br/>{dollars(g.pendingUsd)} pending</td>
      <td>{dollars(g.agencyPaidUsd)} paid<br/>{dollars(g.agencyPendingUsd)} pending</td>
      <td>{new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(g.latestRequestAt))} IST<br/>
        <small>{g.pendingCount} Pending Payment / {g.paidCount} Paid{Number(g.reversedCount)>0?` / ${g.reversedCount} Failed or Reversed`:''}</small></td>
      <td><button onClick={()=>onOpen(g.agencyKey)}>Open Agency</button></td>
    </tr>)}</tbody></table>{!groups.length&&<p>No Agency payout activity matches these filters.</p>}</div>;
}
export function AgencyPaymentWorkspace({agencyGroup,candidates,busy,onSave}:{agencyGroup:string;candidates:PaymentCandidates;busy:boolean;onSave:(v:object)=>void}) {
  const [kind,setKind]=useState('paid');
  const preview=candidates[kind];
  return <section className="panel"><h2>Agency payment workspace</h2>
    <p>Record payments already made by the company. This does not initiate a bank transfer or create another payout. Saved rates and Agency associations remain unchanged.</p>
    <form key={`${agencyGroup}:${kind}:${preview?.ids.join(',')}`} onSubmit={e=>{
      e.preventDefault();if(!preview?.ids.length||busy)return;const f=new FormData(e.currentTarget);
      onSave({action:'agency-batch',kind,agencyGroup,ids:preview.ids,reference:f.get('reference'),reason:f.get('reason'),confirmed:f.get('confirmed')==='yes'});
    }}>
      <label>Settlement type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="paid">Record Host payments made</option><option value="agency-paid">Record Agency commission paid</option></select></label>
      <p><b>{preview?.ids.length??0} eligible saved requests</b> · Host {dollars(preview?.hostUsd)} · Agency commission {dollars(preview?.agencyUsd)}.</p>
      {preview?.hasMore&&<p>Safety limit: this batch contains the first 100 eligible requests. Refresh after settlement for the next batch.</p>}
      <label>Payment / reconciliation reference<input name="reference" required minLength={3} maxLength={255}/></label>
      <label>Operational reason<textarea name="reason" required minLength={3} maxLength={500}/></label>
      <label><input type="checkbox" name="confirmed" value="yes" required/>I confirm the displayed payment totals and exact saved request set.</label>
      <button disabled={busy||!preview?.ids.length}>Record Agency-wise settlement</button>
    </form></section>;
}
