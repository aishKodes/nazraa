"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { findAdjustmentTarget } from "@/lib/db/repositories/master-adjustments";
import type { MasterAdjustmentInput } from "@/lib/finance/master-adjustment";
import { formatNumber } from "@/lib/utils/format";

export function MasterAdjustmentForm({ target }: { target: NonNullable<Awaited<ReturnType<typeof findAdjustmentTarget>>> }) {
  const router = useRouter();
  const [draft, setDraft] = useState<MasterAdjustmentInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  function prepare(form: FormData) {
    const asset = form.get('asset') === 'DIAMOND' ? 'DIAMOND' : 'COIN';
    const action = form.get('action') === 'REMOVE' ? 'REMOVE' : 'ADD';
    const amount = Number(form.get('amount'));
    const expectedBalance = asset === 'COIN' ? target.coins : target.diamonds;
    const after = expectedBalance + (action === 'ADD' ? amount : -amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(after) || after < 0) {
      setMessage('Enter a positive whole amount within the available balance and safe supported range.'); return;
    }
    setMessage('');
    setDraft({userId:target.id,asset,action,amount,expectedBalance,reason:String(form.get('reason')).trim(),internalNote:String(form.get('internalNote')??'').trim(),idempotencyKey:crypto.randomUUID(),confirmed:true});
  }
  async function execute() {
    if (!draft || busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/control/wallet-adjustments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft),signal:AbortSignal.timeout(30_000)});
      const body = await response.json();
      if (!response.ok) {
        setUncertain(response.status >= 500);
        setMessage(body.error || 'The adjustment was not confirmed. Retry the same request.'); return;
      }
      setUncertain(false); setDone(true);
      setMessage(`${body.result.replayed?'Previously completed':'Completed'} · ${body.result.transactionCode} · ${formatNumber(body.result.before)} → ${formatNumber(body.result.after)}. No duplicate entry was created.`);
      router.refresh();
    } catch {
      setUncertain(true); setMessage('The response was interrupted. Retry this same request to confirm the result safely. Do not start a new adjustment.');
    } finally { setBusy(false); }
  }
  if (done) return <div role="status"><p className="notice success">{message}</p><button className="secondary-button" onClick={()=>{setDraft(null);setDone(false);setMessage('');}}>New adjustment</button></div>;
  return <>
    {message ? <p role="alert" className="notice error">{message}</p> : null}
    {!draft ? <form action={prepare} className="stack-form">
      <div className="two-fields"><label>Asset<select name="asset"><option value="COIN">Coins</option><option value="DIAMOND">Diamonds</option></select></label>
      <label>Action<select name="action"><option value="ADD">Add</option><option value="REMOVE">Remove</option></select></label></div>
      <label>Amount<input name="amount" type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required /></label>
      <label>Reason<input name="reason" required minLength={5} maxLength={500} /></label>
      <label>Internal note (optional)<textarea name="internalNote" maxLength={1000} /><small>Visible only in Master adjustment history and audit records, never in the mobile wallet response.</small></label>
      <button className="primary-button" type="submit">Review adjustment</button>
    </form> : <section aria-label="Confirm balance adjustment" className="stack-form">
      <h3>Confirm balance adjustment</h3><dl className="detail-list">
        <div><dt>Target</dt><dd>{target.name} · {target.publicId}</dd></div>
        <div><dt>Asset / action</dt><dd>{draft.asset === 'COIN'?'Coins':'Diamonds'} · {draft.action === 'ADD'?'Add':'Remove'}</dd></div>
        <div><dt>Amount</dt><dd>{formatNumber(draft.amount)}</dd></div>
        <div><dt>Current available balance</dt><dd>{formatNumber(draft.expectedBalance)}</dd></div>
        <div><dt>Expected new balance</dt><dd>{formatNumber(draft.expectedBalance+(draft.action==='ADD'?draft.amount:-draft.amount))}</dd></div>
        <div><dt>Reason</dt><dd>{draft.reason}</dd></div>
      </dl><p>Reserved Diamonds are not changed. This action creates one immutable ledger entry and one audit record.</p>
      <div className="action-row"><button className="danger-button" type="button" disabled={busy} onClick={execute}>{busy?'Confirming…':uncertain?'Retry same request safely':'Confirm and apply once'}</button>
      <button className="secondary-button" type="button" disabled={busy||uncertain} onClick={()=>setDraft(null)}>Back</button></div>
    </section>}
  </>;
}
