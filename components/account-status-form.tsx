"use client";

import { useActionState, useState } from "react";
import { submitAccountStatus } from "@/app/admin-actions";

export function AccountStatusForm({ accountId, status }: { accountId: string; status: "ACTIVE" | "SUSPENDED" }) {
  const nextStatus = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const actionLabel = nextStatus === "SUSPENDED" ? "Suspend account" : "Reactivate account";
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, action, pending] = useActionState(submitAccountStatus, { error: null });

  return <form action={action} onReset={(event) => event.preventDefault()} className="stack-form account-status-form">
    <input type="hidden" name="accountId" value={accountId} />
    <input type="hidden" name="expectedStatus" value={status} />
    <input type="hidden" name="nextStatus" value={nextStatus} />
    <label>{nextStatus === "SUSPENDED" ? "Suspension reason" : "Reactivation reason"}<input name="reason" required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={nextStatus === "SUSPENDED" ? "Why is this account being suspended?" : "Why is access being restored?"} /></label>
    <label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />Confirm {actionLabel.toLowerCase()}</label>
    {state.error ? <p className="notice notice-error" role="alert">{state.error}</p> : null}
    <button className={nextStatus === "SUSPENDED" ? "danger-button" : "primary-button"} type="submit" disabled={pending}>{pending ? "Saving…" : actionLabel}</button>
    <p className="form-note">Suspension blocks this management ID immediately. Reactivation restores login access.</p>
  </form>;
}
