"use client";

import { useEffect, useRef, useState } from 'react';
import type { AdjustmentTarget, MasterAdjustmentInput } from '@/lib/finance/master-adjustment';
import { formatNumber } from '@/lib/utils/format';
import styles from './master-allocation.module.css';

export function MasterAdjustmentForm({target,onCompleted,onPendingChange}: {
  target: AdjustmentTarget;
  onCompleted: (target: AdjustmentTarget) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [asset,setAsset] = useState<'COIN'|'DIAMOND'>('COIN');
  const [action,setAction] = useState<'ADD'|'REMOVE'>('ADD');
  const [amount,setAmount] = useState('');
  const [draft,setDraft] = useState<MasterAdjustmentInput|null>(null);
  const [busy,setBusy] = useState(false);
  const [uncertain,setUncertain] = useState(false);
  const [message,setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const balance = asset === 'COIN' ? target.coins : target.diamonds;
  const numericAmount = Number(amount);
  const after = balance + (action === 'ADD' ? numericAmount : -numericAmount);
  const valid = Number.isSafeInteger(numericAmount) && numericAmount > 0 && Number.isSafeInteger(after) && after >= 0;
  useEffect(()=>{if(draft) dialog.current?.showModal();},[draft]);
  function cancel() {
    if (busy || uncertain) return;
    dialog.current?.close();setDraft(null);onPendingChange(false);
  }
  function prepare(form: FormData) {
    if (!valid || inFlight.current) return;
    setMessage('');onPendingChange(true);
    setDraft({userId:target.id,ownerType:target.ownerType,asset,action,amount:numericAmount,expectedBalance:balance,
      reason:String(form.get('reason')??'').trim(),internalNote:'',idempotencyKey:crypto.randomUUID(),confirmed:true});
  }
  async function execute() {
    if (!draft || inFlight.current) return;
    inFlight.current=true;setBusy(true);setMessage('');
    try {
      const response = await fetch('/api/control/wallet-adjustments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft),signal:AbortSignal.timeout(30_000)});
      const body = await response.json();
      if (!response.ok) {
        setUncertain(response.status >= 500);
        setMessage(body.error || 'The adjustment was not confirmed. Retry the same request.');return;
      }
      setUncertain(false);
      setMessage(`${body.result.replayed?'Previously completed':'Completed'} · ${body.result.transactionCode} · ${formatNumber(body.result.before)} → ${formatNumber(body.result.after)}.`);
      dialog.current?.close();setDraft(null);setAmount('');onPendingChange(false);
      onCompleted({...target,[draft.asset === 'COIN' ? 'coins' : 'diamonds']:body.result.after});
    } catch {
      setUncertain(true);setMessage('The response was interrupted. Retry this same request safely; do not start a new adjustment.');
    } finally {inFlight.current=false;setBusy(false);}
  }
  return <>
    {!draft && message ? <p role="status" className="notice">{message}</p>:null}
    <form action={prepare} className="stack-form">
      <div className="two-fields"><label>Asset<select aria-label="Asset" value={asset} onChange={e=>setAsset(e.target.value as typeof asset)}><option value="COIN">Coins</option><option value="DIAMOND">Diamonds</option></select></label>
        <label>Action<select aria-label="Action" value={action} onChange={e=>setAction(e.target.value as typeof action)}><option value="ADD">Add</option><option value="REMOVE">Remove</option></select></label></div>
      <label>Amount<input aria-label="Amount" type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      {amount?<p aria-live="polite" className={action==='REMOVE'?styles.debit:styles.preview}>{action==='REMOVE'?'Debit':'Credit'} · {formatNumber(balance)} → {valid?formatNumber(after):'Enter a valid amount within the available balance'}</p>:null}
      <label>Reason<input name="reason" required minLength={5} maxLength={500} placeholder="e.g. Owner instruction or balance correction" list="allocation-reasons"/></label>
      <datalist id="allocation-reasons">{['Manual allocation','Correction','Owner instruction','Promotion','Balance correction'].map(reason=><option key={reason} value={reason}/>)}</datalist>
      <button className={action==='REMOVE'?'danger-button':'primary-button'} type="submit" disabled={!valid}>Review {action==='ADD'?'add':'remove'} {valid?formatNumber(numericAmount):''} {asset==='COIN'?'Coins':'Diamonds'}</button>
    </form>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="allocation-confirm-title" onCancel={event=>{event.preventDefault();cancel();}}>
      {draft?<><h2 id="allocation-confirm-title">Confirm {draft.action==='REMOVE'?'debit':'allocation'}</h2>
        <p>{target.name} · ID {target.publicId}<br/>{target.role.replaceAll('_',' ')} · {target.ownerType==='PLATFORM_ACCOUNT'?'Platform wallet':'App wallet'} · {target.status}</p>
        <div className={draft.action==='REMOVE'?styles.debit:styles.preview}>{draft.action==='ADD'?'ADD':'REMOVE'} {formatNumber(draft.amount)} {draft.asset==='COIN'?'Coins':'Diamonds'}</div>
        <dl className="detail-list"><div><dt>Current balance</dt><dd>{formatNumber(draft.expectedBalance)}</dd></div>
          <div><dt>New balance</dt><dd>{formatNumber(draft.expectedBalance+(draft.action==='ADD'?draft.amount:-draft.amount))}</dd></div>
          <div><dt>Reason</dt><dd>{draft.reason}</dd></div></dl>
        <p className={styles.hint}>One ledger transaction and audit record. Reserved balances are unchanged.</p>
        {message?<p role="alert" className="notice error">{message}</p>:null}
        <div className="action-row"><button type="button" className="secondary-button" disabled={busy||uncertain} onClick={cancel}>Cancel</button>
          <button type="button" className={draft.action==='REMOVE'?'danger-button':'primary-button'} disabled={busy} onClick={execute}>{busy?'Confirming…':uncertain?'Retry same request safely':'Confirm'}</button></div>
      </>:null}
    </dialog>
  </>;
}
