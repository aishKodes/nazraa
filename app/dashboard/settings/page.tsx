import { LockKeyhole, ShieldCheck } from "lucide-react";
import {
  submitCommerceSettings,
  submitDailyRewardRules,
  submitDiamondConversionRule,
  submitEconomySettings,
  submitHostRewardRules,
  submitMobileAppSettings,
  submitMobileSocialSettings,
  submitRoomFeatureSettings,
  submitRocketSettings,
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
  const social = settings.find((item) => item.key === "mobile.social")?.value as { private_message_coin_cost?: number } | undefined;
  const roomFeatures = settings.find((item) => item.key === "mobile.room_features")?.value as {
    interactions?: { key: string; label: string; emoji: string; enabled?: boolean; visualUrl?: string }[];
    pkModes?: string[];
    presenceWarningLimit?: number;
    presenceSuspensionLimit?: number;
  } | undefined;
  const interactions = roomFeatures?.interactions ?? [
    { key: "kiss", label: "Kiss", emoji: "💋", enabled: true },
    { key: "love", label: "Love", emoji: "💖", enabled: true },
    { key: "hug", label: "Hug", emoji: "🤗", enabled: true },
  ];
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
        <p>Google ID tokens are verified server-side. The current private-beta Face Verification stores one encrypted selfie and approves it automatically; no external biometric provider is called.</p>
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
        <label>Video Live coins/hour<input name="live" type="number" min="0" required defaultValue={host("LIVE", 3500)} /></label>
        <label>Face Live coins/hour<input name="face" type="number" min="0" required defaultValue={host("FACE", 3500)} /></label>
        <label>Party coins/hour<input name="party" type="number" value="0" readOnly aria-readonly="true" /><span>Audio Party hourly reward remains disabled.</span></label>
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
      <div className="card-title"><div><h2>Private messaging</h2><p>Each sent private message debits this many user coins in the same atomic transaction that creates the message.</p></div></div>
      <form action={submitMobileSocialSettings} className="form-grid">
        <label>Coins per message<input name="privateMessageCoinCost" type="number" min="0" max="100000" required defaultValue={social?.private_message_coin_cost ?? 50} /></label>
        <label>Confirm<button className="primary-button" type="submit">Save message price</button></label>
      </form>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Party &amp; Live room features</h2><p>Published interaction labels, PK modes, and Face Live safety limits. Mobile clients receive changes during silent refresh.</p></div></div>
      <form action={submitRoomFeatureSettings} className="form-grid">
        <label className="span-two">Interactions — one per line<textarea name="interactionRows" rows={7} required defaultValue={interactions.map((item) => `${item.key} | ${item.label} | ${item.emoji} | ${item.enabled === false ? "disabled" : "enabled"}`).join("\n")} /><span>Format: key | label | emoji | enabled/disabled. Add, edit, disable, or remove rows; no APK update is required.</span></label>
        <label>Animation target key<input name="interactionAssetKey" placeholder="Example: kiss" /></label>
        <label>Upload/replace animation<input name="interactionAsset" type="file" accept="image/jpeg,image/png,image/webp" /><span>JPG, PNG, or animated WebP · max 1 MB. Existing artwork stays unless replaced.</span></label>
        <label className="span-two">PK modes (comma separated)<input name="pkModes" required defaultValue={(roomFeatures?.pkModes ?? ["Classic", "Auto PK", "Individual", "Random"]).join(", ")} /></label>
        <label>Presence failures before stop<input name="presenceWarningLimit" type="number" min="3" max="30" required defaultValue={roomFeatures?.presenceWarningLimit ?? 10} /></label>
        <label>Auto-stops before suspension<input name="presenceSuspensionLimit" type="number" min="1" max="20" required defaultValue={roomFeatures?.presenceSuspensionLimit ?? 5} /></label>
        <label>Confirm<button className="primary-button" type="submit">Publish room features</button></label>
      </form>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Rocket controls</h2><p>Authoritative gifting energy, six progression thresholds, reward groups, level/VIP eligibility, and status used immediately by Party rooms.</p></div></div>
      <form action={submitRocketSettings} className="form-grid">
        <label>Availability<select name="rocketEnabled" defaultValue={completion.rocket.enabled ? "true" : "false"}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
        <label>Energy per gifted coin<input name="energyPerCoin" type="number" min="1" max="100" required defaultValue={completion.rocket.energyPerCoin} /></label>
        <label>Minimum User Level<input name="minimumUserLevel" type="number" min="1" max="120" required defaultValue={completion.rocket.minimumUserLevel} /></label>
        <label>Minimum VIP tier<input name="minimumVipTier" type="number" min="0" max="5" required defaultValue={completion.rocket.minimumVipTier} /></label>
        <label>VIP energy bonus %<input name="vipEnergyBonusPercent" type="number" min="0" max="500" required defaultValue={completion.rocket.vipEnergyBonusPercent} /></label>
        {completion.rocket.tiers.map((tier) => <div className="form-grid span-two" key={tier.level}>
          <label>LV{tier.level} threshold<input name={`rocket${tier.level}Target`} type="number" min="1" required defaultValue={tier.target} /></label>
          <label>Top 1 reward<input name={`rocket${tier.level}Top1`} type="number" min="0" required defaultValue={tier.top1} /></label>
          <label>Top 2 reward<input name={`rocket${tier.level}Top2`} type="number" min="0" required defaultValue={tier.top2} /></label>
          <label>Top 3 reward<input name={`rocket${tier.level}Top3`} type="number" min="0" required defaultValue={tier.top3} /></label>
          <label>In-room reward<input name={`rocket${tier.level}Room`} type="number" min="0" required defaultValue={tier.room} /></label>
        </div>)}
        <label className="span-two">Change reason<input name="reason" required minLength={5} maxLength={500} placeholder="Why is the Rocket configuration changing?" /></label>
        <label>Confirm<button className="primary-button" type="submit">Save Rocket controls</button></label>
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
