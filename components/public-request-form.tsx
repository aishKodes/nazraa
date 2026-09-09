"use client";

import { useState } from "react";

const categories = ["ACCOUNT", "VERIFICATION", "AGENCY", "PURCHASE", "SAFETY", "PRIVACY", "DELETION", "CHILD_SAFETY", "COPYRIGHT"] as const;

export function PublicRequestForm({ mode, defaultCategory }: { mode: "support" | "deletion"; defaultCategory?: typeof categories[number] }) {
  const [state, setState] = useState<{ busy: boolean; message: string; error: boolean }>({ busy: false, message: "", error: false });
  async function submit(formData: FormData) {
    setState({ busy: true, message: "", error: false });
    const payload = mode === "deletion"
      ? { email: formData.get("email"), publicId: formData.get("publicId"), message: formData.get("message") }
      : { category: formData.get("category"), email: formData.get("email"), subject: formData.get("subject"), message: formData.get("message") };
    try {
      const response = await fetch(`/api/public/${mode === "deletion" ? "account-deletion" : "support"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const value = await response.json() as { message?: string; requestCode?: string };
      if (!response.ok) throw new Error(value.message || "We couldn't submit this request. Please try again.");
      setState({ busy: false, error: false, message: `${value.message ?? "Request received."}${value.requestCode ? ` Reference: ${value.requestCode}` : ""}` });
    } catch (error) {
      setState({ busy: false, error: true, message: error instanceof Error ? error.message : "We couldn't submit this request. Please try again." });
    }
  }
  return <form action={submit} className="rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/[0.06] p-6">
    <h2 className="text-xl font-semibold text-white">{mode === "deletion" ? "Initiate deletion" : "Contact Nazraa Support"}</h2>
    <div className="mt-5 grid gap-4">
      {mode === "support" && <label className="grid gap-2 text-sm text-slate-200">Category<select name="category" defaultValue={defaultCategory ?? "ACCOUNT"} className="rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white">{categories.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>}
      <label className="grid gap-2 text-sm text-slate-200">Email<input required type="email" name="email" autoComplete="email" maxLength={190} className="rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white" /></label>
      {mode === "deletion" && <label className="grid gap-2 text-sm text-slate-200">Nazraa user ID<input required name="publicId" inputMode="numeric" pattern="[0-9]+" maxLength={12} className="rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white" /></label>}
      {mode === "support" && <label className="grid gap-2 text-sm text-slate-200">Subject<input required name="subject" minLength={3} maxLength={160} className="rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white" /></label>}
      <label className="grid gap-2 text-sm text-slate-200">Details<textarea required={mode === "support"} name="message" minLength={mode === "support" ? 10 : 0} maxLength={2000} rows={5} className="rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white" /></label>
      <button disabled={state.busy} className="rounded-xl bg-fuchsia-500 px-5 py-3 font-semibold text-white disabled:opacity-60">{state.busy ? "Submitting…" : "Submit secure request"}</button>
      {state.message && <p role="status" className={state.error ? "text-sm text-red-300" : "text-sm text-emerald-300"}>{state.message}</p>}
    </div>
  </form>;
}
