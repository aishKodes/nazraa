import { LockKeyhole, ShieldCheck } from "lucide-react";
import {
  submitCommerceSettings,
  submitDailyRewardRules,
  submitDiamondConversionRule,
  submitEconomySettings,
  submitHostRewardRules,
  submitMobileAppSettings,
} from "@/app/admin-actions";
import { Card, Notice, SectionHeading } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { getSystemSettings } from "@/lib/db/repositories/catalog";
import { getCompletionAdminSettings } from "@/lib/db/repositories/completion-administration";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  await requirePermission("settings.manage");
  const [{ error, success }, settings, completion] = await Promise.all([searchParams, getSystemSettings(), getCompletionAdminSettings()]);
  const economy = settings.find((item) => item.key === "economy.diamond_conversion")?.value as { rate?: number; minimum?: number; currency?: string } | undefined;
  const mobile = settings.find((item) => item.key === "mobile.app_config")?.value as { minimumVersion?: string; latestVersion?: string; maintenance?: boolean; maintenanceMessage?: string; updateUrl?: string; supportUrl?: string; withdrawalUrl?: string } | undefined;
  const commerce = settings.find((item) => item.key === "mobile.commerce")?.value as { minimumWithdrawal?: number; whatsappMessageTemplate?: string; supportUrl?: string; withdrawalPortalUrl?: string } | undefined;
  const reward = (day: number, fallback: number) => completion.dailyRewards.find((item) => item.dayNumber === day)?.coins ?? fallback;
  const host = (roomType: string, fallback: number) => completion.hostRules.find((item) => item.roomType === roomType)?.coinsPerHour ?? fallback;
  const minimumEligible = completion.hostRules[0]?.minimumEligibleSeconds ?? 60;

  return <>
    <SectionHeading title="Platform settings" description="Global product and commercial rules are server-owned; every change is audited." />
    {success ? <Notice type="success">{success}</Notice> : null}
    {error ? <Notice type="error">{error}</Notice> : null}

    <div className="report-grid">
      <Card>
        <ShieldCheck className="report-icon" size={24} />
        <h2>Cash conversion baseline</h2>
        <p>Legacy cash-withdrawal display rule. Historic transactions keep their original snapshot.</p>
        <form action={submitEconomySettings} className="stack-form full-width">
          <label>Conversion rate<input name="rate" type="number" min="0.0001" step="0.0001" defaultValue={economy?.rate ?? 1} required /></label>
          <label>Minimum diamonds<input name="minimum" type="number" min="1" defaultValue={economy?.minimum ?? 1000} required /></label>
          <label>Currency<input name="currency" minLength={3} maxLength={3} defaultValue={economy?.currency ?? "INR"} required /></label>
          <button className="primary-button" type="submit">Save cash rule</button>
        </form>
      </Card>
      <Card>
        <LockKeyhole className="report-icon" size={24} />
        <h2>Security baseline</h2>
        <p>Google ID tokens are verified server-side. Face frames go only to the configured biometric provider. Database and biometric secrets never enter browser or Flutter bundles.</p>
        <span className="scope-lock">Server controlled</span>
      </Card>
    </div>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Daily Rewards</h2><p>Seven-day server-time cycle used by every authenticated user.</p></div></div>
      <form action={submitDailyRewardRules} className="form-grid">
        {[1,2,3,4,5,6,7].map((day) => <label key={day}>Day {day} coins<input name={`day${day}`} type="number" min="0" required defaultValue={reward(day, [100,150,200,300,500,750,1500][day - 1])} /></label>)}
        <label className="span-two">Change reason<input name="reason" required minLength={5} maxLength={500} placeholder="Why are reward amounts changing?" /></label>
        <label>Confirm<button className="primary-button" type="submit">Save Daily Rewards</button></label>
      </form>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Diamond → Coin exchange</h2><p>Creates a new effective rule. Wallet debit, credit, history, and ledgers commit atomically.</p></div></div>
      <form action={submitDiamondConversionRule} className="form-grid">
        <label>Diamond step<input name="diamonds" type="number" min="1" required defaultValue={completion.conversion?.diamonds ?? 100} /></label>
        <label>Coins per step<input name="coins" type="number" min="1" required defaultValue={completion.conversion?.coins ?? 100} /></label>
        <label>Minimum diamonds<input name="minimum" type="number" min="1" required defaultValue={completion.conversion?.minimum ?? 100} /></label>
        <label>Maximum diamonds<input name="maximum" type="number" min="1" required defaultValue={completion.conversion?.maximum ?? 1000000} /></label>
        <label className="span-two">Change reason<input name="reason" required minLength={5} maxLength={500} /></label>
        <label>Confirm<button className="primary-button" type="submit">Publish exchange rule</button></label>
      </form>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Server-timed host rewards</h2><p>Party, Video Live, and Face Live use independent hourly rules. The phone clock is never trusted.</p></div></div>
      <form action={submitHostRewardRules} className="form-grid">
        <label>Video Live coins/hour<input name="live" type="number" min="0" required defaultValue={host("LIVE", 2000)} /></label>
        <label>Face Live coins/hour<input name="face" type="number" min="0" required defaultValue={host("FACE", 2000)} /></label>
        <label>Party coins/hour<input name="party" type="number" min="0" required defaultValue={host("PARTY", 0)} /></label>
        <label>Minimum eligible seconds<input name="minimumEligibleSeconds" type="number" min="1" max="3600" required defaultValue={minimumEligible} /></label>
        <label className="span-two">Change reason<input name="reason" required minLength={5} maxLength={500} /></label>
        <label>Confirm<button className="primary-button" type="submit">Save host rewards</button></label>
      </form>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Mobile app configuration</h2><p>Version, maintenance, update, support, and withdrawal links returned by the public config endpoint.</p></div></div>
      <form action={submitMobileAppSettings} className="form-grid">
        <label>Minimum version<input name="minimumVersion" required defaultValue={mobile?.minimumVersion ?? "1.0.0"} /></label>
        <label>Latest version<input name="latestVersion" required defaultValue={mobile?.latestVersion ?? "1.0.0"} /></label>
        <label>Maintenance<select name="maintenance" defaultValue={mobile?.maintenance ? "true" : "false"}><option value="false">Off</option><option value="true">On</option></select></label>
        <label className="span-two">Maintenance message<input name="maintenanceMessage" maxLength={500} defaultValue={mobile?.maintenanceMessage ?? ""} /></label>
        <label>Update URL<input name="updateUrl" type="url" defaultValue={mobile?.updateUrl ?? ""} /></label>
        <label>Support URL<input name="supportUrl" type="url" defaultValue={mobile?.supportUrl ?? ""} /></label>
        <label>Withdrawal URL<input name="withdrawalUrl" type="url" defaultValue={mobile?.withdrawalUrl ?? ""} /></label>
        <label>Confirm<button className="primary-button" type="submit">Save app config</button></label>
      </form>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Mobile commerce</h2><p>Approved-seller WhatsApp handoff and the host withdrawal floor.</p></div></div>
      <form action={submitCommerceSettings} className="form-grid">
        <label>Minimum withdrawal<input name="minimumWithdrawal" type="number" min="1" required defaultValue={commerce?.minimumWithdrawal ?? 1000} /></label>
        <label>Support URL<input name="supportUrl" type="url" defaultValue={commerce?.supportUrl ?? ""} /></label>
        <label>Withdrawal portal URL<input name="withdrawalPortalUrl" type="url" defaultValue={commerce?.withdrawalPortalUrl ?? ""} /></label>
        <label className="span-two">WhatsApp order template<textarea name="whatsappMessageTemplate" required minLength={20} maxLength={1000} rows={7} defaultValue={commerce?.whatsappMessageTemplate ?? "Hello, I want to purchase Nazraa Live coins.\n\nMy User ID: {userId}\nAgency ID: {agencyId}\nSelected Package: {package}\nOrder ID: {orderId}\n\nPlease share payment details."} /></label>
        <label>Supported placeholders<span>{"{userId} {agencyId} {package} {orderId}"}</span><button className="primary-button" type="submit">Save commerce</button></label>
      </form>
    </Card>
  </>;
}
