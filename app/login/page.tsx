import { LockKeyhole, ShieldCheck } from "lucide-react";
import { signIn } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="login-page">
    <section className="login-card">
      <div className="login-brand"><span className="brand-mark">N</span><span>Nazraa <em>Control</em></span></div>
      <div className="login-intro"><span className="eyebrow"><ShieldCheck size={15} />Secure operations access</span><h1>Welcome back</h1><p>Enter the role code assigned to you. Your workspace opens with only the records and actions you are allowed to use.</p></div>
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <form action={signIn} className="login-form">
        <label>Role code<input name="roleCode" placeholder="e.g. ADM-4F2A91B7" autoCapitalize="characters" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" placeholder="Your password" autoComplete="current-password" required /></label>
        <button className="primary-button full" type="submit"><LockKeyhole size={17} />Sign in securely</button>
      </form>
      <p className="login-help">Need access? Contact the platform Master. There is no public sign-up.</p>
    </section>
  </main>;
}
