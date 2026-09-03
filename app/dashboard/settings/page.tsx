import { LockKeyhole, ShieldCheck } from "lucide-react";
import {
  submitCommerceSettings,
  submitDailyRewardRules,
  submitDiamondConversionRule,
  submitEconomySettings,
  submitHostRewardRules,
  submitGameSettings,
  submitMobileAppSettings,
  submitMobileSocialSettings,
  submitRoomFeatureSettings,
  submitRocketSettings,
  submitVipValidity,
  submitWithdrawalEconomy,
} from "@/app/admin-actions";
import { Card, Notice, SectionHeading } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { getSystemSettings } from "@/lib/db/repositories/catalog";
import { getCompletionAdminSettings } from "@/lib/db/repositories/completion-administration";
import { configurableGameIds, mobileGamesConfig } from "@/lib/games/game-config";
import { parseWithdrawalEconomy } from "@/lib/db/repositories/withdrawal-economy";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  await requirePermission("settings.manage");
  const [{ error, success }, settings, completion] = await Promise.all([searchParams, getSystemSettings(), getCompletionAdminSettings()]);
  const economy = settings.find((item) => item.key === "economy.diamond_conversion")?.value as { rate?: number; minimum?: number; currency?: string } | undefined;
  const mobile = settings.find((item) => item.key === "mobile.app_config")?.value as { minimumVersion?: string; latestVersion?: string; maintenance?: boolean; maintenanceMessage?: string; updateUrl?: string; supportUrl?: string; withdrawalUrl?: string } | undefined;
  const commerce = settings.find((item) => item.key === "mobile.commerce")?.value as { minimumWithdrawal?: number; whatsappMessageTemplate?: string; supportUrl?: string; withdrawalPortalUrl?: string } | undefined;
  const withdrawal = parseWithdrawalEconomy(settings.find((item) => item.key === "withdrawal.economy")?.value);
  const social = settings.find((item) => item.key === "mobile.social")?.value as { private_message_coin_cost?: number } | undefined;
  const gameSettings = mobileGamesConfig(settings.find((item) => item.key === "mobile.games")?.value);
  const roomFeatures = settings.find((item) => item.key === "mobile.room_features")?.value as {
    interactions?: { key: string; label: string; emoji: string; enabled?: boolean; visualUrl?: string }[];
    pkModes?: string[];
    presenceWarningLimit?: number;
    presenceSuspensionLimit?: number;
    facePassivePlaybackMode?: "rtc_fallback" | "live_streaming";
    partyPassivePlaybackMode?: "dynamic_rtc_fallback" | "live_streaming";
    partyStreamingThreshold?: number;
    streamMixingEnabled?: boolean;
    pkCompositeStreamingEnabled?: boolean;
    mediaReconnectGraceSeconds?: number;
    passiveBackgroundGraceSeconds?: number;
    maxFaceAudioGuests?: number;
    rtcPassiveFallbackCeiling?: number;
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
        <h2>Legacy diamond display</h2>
        <p>Compatibility setting for older records only. Current withdrawals use the immutable payout configuration below.</p>
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
      <div className="card-title"><div><h2>Withdrawal economics</h2><p>Applied only when a withdrawal is completed. Historic payout snapshots never change.</p></div></div>
      <form action={submitWithdrawalEconomy} className="form-grid">
        <label>Diamond slab<input name="slabDiamonds" type="number" min="1" required defaultValue={withdrawal.slabDiamonds} /></label>
        <label>Total USD cents / slab<input name="totalUsdCents" type="number" min="1" required defaultValue={withdrawal.totalUsdCents} /></label>
        <label>Host USD cents<input name="hostUsdCents" type="number" min="0" required defaultValue={withdrawal.hostUsdCents} /></label>
        <label>Agency USD cents<input name="agencyUsdCents" type="number" min="0" required defaultValue={withdrawal.agencyUsdCents} /></label>
        <label>Super Admin USD cents<input name="superAdminUsdCents" type="number" min="0" required defaultValue={withdrawal.superAdminUsdCents} /></label>
        <label>Admin USD cents<input name="adminUsdCents" type="number" min="0" required defaultValue={withdrawal.adminUsdCents} /></label>
        <label>BD USD cents<input name="bdUsdCents" type="number" min="0" required defaultValue={withdrawal.bdUsdCents} /></label>
        <label>Country Manager USD cents<input name="countryManagerUsdCents" type="number" min="0" required defaultValue={withdrawal.countryManagerUsdCents} /></label>
        <label>Company USD cents<input name="companyUsdCents" type="number" min="0" required defaultValue={withdrawal.companyUsdCents} /></label>
        <label>USD → INR rate<input name="usdInrRate" type="number" min="0.01" max="1000" step="0.000001" required defaultValue={withdrawal.usdInrRate} /></label>
        <label className="span-two">Change reason<input name="reason" required minLength={5} maxLength={500} placeholder="Why is the withdrawal configuration changing?" /></label>
        <label>Confirm<button className="primary-button" type="submit">Save withdrawal economics</button></label>
      </form>
    </Card>

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
        <label>Video Live diamonds/hour<input name="live" type="number" min="0" required defaultValue={host("LIVE", 3500)} /></label>
        <label>Face Live diamonds/hour<input name="face" type="number" min="0" required defaultValue={host("FACE", 3500)} /></label>
        <label>Party diamonds/hour<input name="party" type="number" value="0" readOnly aria-readonly="true" /><span>Audio Party hourly reward remains disabled.</span></label>
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
      <div className="card-title"><div><h2>Game controls</h2><p>Server-owned availability, limits, timers, outcome weights, social history, and verified special-result controls. Saving never chooses a manual winner.</p></div></div>
      <div className="stack-form full-width">
        {configurableGameIds.map((gameId) => {
          const game = gameSettings.games[gameId];
          const name = ({ teen_patti_pro: "Teen Patti Pro", luck77: "Luck77", greedy_lion: "Greedy Lion", greedy_king: "Greedy King", bounty_football: "Bounty Football", jungle_hunt: "Jungle Hunt" } as const)[gameId];
          const greedy = gameId === "greedy_lion" || gameId === "greedy_king";
          const availability = !game.enabled ? "DISABLED" : game.maintenance ? "MAINTENANCE" : "ACTIVE";
          return <details key={gameId} className="scope-lock">
            <summary><strong>{name}</strong> · {availability.toLowerCase()} · {game.bettingSeconds ? `${game.bettingSeconds}s shared betting` : "individual spin"}</summary>
            <form action={submitGameSettings} className="form-grid" style={{ marginTop: 14 }}>
              <input name="game" type="hidden" value={gameId} />
              <label>Availability<select name="availability" defaultValue={availability}><option value="ACTIVE">Active</option><option value="MAINTENANCE">Maintenance</option><option value="DISABLED">Disabled</option></select></label>
              <label>Reference hit frequency<input name="targetWinRate" type="number" min="0" max="1" step="0.01" required defaultValue={game.targetWinRate} /><span>Reporting target only: 0.50 for Teen Patti/Luck77 and 0.40 for the others. Results never inspect a player&apos;s bets.</span></label>
              <label>Fixed mathematical RTP<input value={`${(game.targetRtp * 100).toFixed(1)}%`} readOnly /><span>Payout scales are server-owned and verified statistically before deployment.</span></label>
              <label>Maximum payout × wager<input name="maximumPayoutMultiplier" type="number" min="1" max="1000" step="0.01" required defaultValue={game.maximumPayoutMultiplier} /><span>Jungle Hunt is capped at 20× to prevent tiny spins producing extreme credits.</span></label>
              <label>Betting seconds<input name="bettingSeconds" type="number" min="0" max="300" required defaultValue={game.bettingSeconds} /></label>
              <label>Minimum bet<input name="minimumBet" type="number" min="1" required defaultValue={game.minimumBet} /></label>
              <label>Maximum per round<input name="maximumBet" type="number" min="1" required defaultValue={game.maximumBet} /></label>
              <label className="span-two">Chip denominations<input name="denominations" required defaultValue={game.denominations.join(", ")} /><span>Comma separated. Existing app buttons refresh from server controls where supported.</span></label>
              <label>Global history length<input name="historyLength" type="number" min="1" max="50" required defaultValue={game.historyLength} /></label>
              <label>Big Winner threshold<input name="bigWinThreshold" type="number" min="1" required defaultValue={game.bigWinThreshold} /></label>
              <label>Repeat Bet<select name="repeatBet" defaultValue={String(game.repeatBet)}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
              <label>Auto Play<select name="autoPlay" defaultValue={String(game.autoPlay)}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
              {gameId === "luck77" || gameId === "bounty_football" ? <label className="span-two">Outcome weights<input name="outcomeWeights" required defaultValue={(game.outcomeWeights ?? []).join(", ")} /><span>{gameId === "luck77" ? "Lucky77, Watermelon, Plum" : "Ten teams in displayed order"}. Weight 0 disables an outcome.</span></label> : <input name="outcomeWeights" type="hidden" value="" />}
              {greedy ? <>
                <label>Salad weight<input name="saladWeight" type="number" min="0" required defaultValue={game.saladWeight ?? 0} /></label>
                <label>Pizza weight<input name="pizzaWeight" type="number" min="0" required defaultValue={game.pizzaWeight ?? 0} /></label>
                <label>Pool contribution (basis points)<input name="poolContributionBps" type="number" min="0" max="10000" required defaultValue={game.poolContributionBps ?? 0} /><span>100 = 1%. Current verified default is 0.</span></label>
                <label>Pool minimum for special<input name="poolMinimumForSpecial" type="number" min="0" required defaultValue={game.poolMinimumForSpecial ?? 0} /></label>
              </> : <>
                <input name="saladWeight" type="hidden" value="0" />
                <input name="pizzaWeight" type="hidden" value="0" />
                <input name="poolContributionBps" type="hidden" value="0" />
                <input name="poolMinimumForSpecial" type="hidden" value="0" />
              </>}
              <label className="span-two">Change reason<input name="reason" required minLength={5} maxLength={500} placeholder="Why is this game configuration changing?" /></label>
              <label>Confirm<button className="primary-button" type="submit">Save {name}</button></label>
            </form>
          </details>;
        })}
      </div>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Party &amp; Live room features</h2><p>Published interaction labels, PK modes, and Face Live safety limits. Mobile clients receive changes during silent refresh.</p></div></div>
      <form action={submitRoomFeatureSettings} className="form-grid">
        <label className="span-two">Interactions — one per line<textarea name="interactionRows" rows={7} required defaultValue={interactions.map((item) => `${item.key} | ${item.label} | ${item.emoji} | ${item.enabled === false ? "disabled" : "enabled"}`).join("\n")} /><span>Format: key | label | emoji | enabled/disabled. Add, edit, disable, or remove rows; no APK update is required.</span></label>
        <label>Animation target key<input name="interactionAssetKey" placeholder="Example: kiss" /></label>
        <label>Upload/replace animation<input name="interactionAsset" type="file" accept="image/jpeg,image/png,image/webp" /><span>JPG, PNG, or animated WebP · max 1 MB. Existing artwork stays unless replaced.</span></label>
        <label className="span-two">PK modes (comma separated)<input name="pkModes" required defaultValue={(roomFeatures?.pkModes ?? ["Classic", "Auto PK", "Random", "Invite/Friends"]).join(", ")} /></label>
        <label>Presence failures before stop<input name="presenceWarningLimit" type="number" min="3" max="30" required defaultValue={roomFeatures?.presenceWarningLimit ?? 10} /></label>
        <label>Auto-stops before suspension<input name="presenceSuspensionLimit" type="number" min="1" max="20" required defaultValue={roomFeatures?.presenceSuspensionLimit ?? 5} /></label>
        <label>Face passive viewers<select name="facePassivePlaybackMode" defaultValue={roomFeatures?.facePassivePlaybackMode ?? "rtc_fallback"}><option value="rtc_fallback">RTC fallback</option><option value="live_streaming">Live Streaming / CDN</option></select></label>
        <label>Party passive listeners<select name="partyPassivePlaybackMode" defaultValue={roomFeatures?.partyPassivePlaybackMode ?? "dynamic_rtc_fallback"}><option value="dynamic_rtc_fallback">RTC fallback</option><option value="live_streaming">Dynamic mixed streaming</option></select></label>
        <label>Party streaming threshold<input name="partyStreamingThreshold" type="number" min="2" max="200" required defaultValue={roomFeatures?.partyStreamingThreshold ?? 9} /><span>Below this member count, Party remains RTC.</span></label>
        <label>ZEGO stream mixing<select name="streamMixingEnabled" defaultValue={String(roomFeatures?.streamMixingEnabled === true)}><option value="false">Inactive / fallback</option><option value="true">Ready when deployment is activated</option></select><span>The app stays on RTC fallback until the deployment activation gate and signed playback URL are both present.</span></label>
        <label>PK composite stream<select name="pkCompositeStreamingEnabled" defaultValue={String(roomFeatures?.pkCompositeStreamingEnabled !== false)}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
        <label>Media reconnect grace (seconds)<input name="mediaReconnectGraceSeconds" type="number" min="5" max="60" required defaultValue={roomFeatures?.mediaReconnectGraceSeconds ?? 60} /></label>
        <label>Passive background grace (seconds)<input name="passiveBackgroundGraceSeconds" type="number" min="5" max="60" required defaultValue={roomFeatures?.passiveBackgroundGraceSeconds ?? 15} /></label>
        <label>Maximum Face audio guests<input name="maxFaceAudioGuests" type="number" min="1" max="12" required defaultValue={roomFeatures?.maxFaceAudioGuests ?? 4} /></label>
        <label>Safe passive RTC fallback ceiling<input name="rtcPassiveFallbackCeiling" type="number" min="1" max="100" required defaultValue={roomFeatures?.rtcPassiveFallbackCeiling ?? 20} /><span>When CDN is unavailable, additional passive viewers are refused instead of silently creating unlimited RTC cost.</span></label>
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
      <div className="card-title"><div><h2>VIP validity</h2><p>Server-owned duration for each paid VIP tier. Existing active purchases keep their recorded expiry.</p></div></div>
      <form action={submitVipValidity} className="form-grid">
        {completion.vipTiers.map((tier) => <label key={tier.tier}>{tier.name} validity days<input name={`vip${tier.tier}`} type="number" min="1" max="3650" required defaultValue={tier.validityDays} /><span>{tier.priceCoins.toLocaleString("en-IN")} coins · daily {tier.dailyRewardCoins.toLocaleString("en-IN")}</span></label>)}
        <label className="span-two">Change reason<input name="reason" required minLength={5} maxLength={500} placeholder="Why is VIP validity changing?" /></label>
        <label>Confirm<button className="primary-button" type="submit">Save VIP validity</button></label>
      </form>
    </Card>

    <Card className="settings-card">
      <div className="card-title"><div><h2>Mobile commerce</h2><p>Approved-seller WhatsApp handoff and the exact Diamond withdrawal slab.</p></div></div>
      <form action={submitCommerceSettings} className="form-grid">
        <label>Withdrawal slab<input name="minimumWithdrawal" type="number" readOnly required value={withdrawal.slabDiamonds} /><span>Managed by Withdrawal economics above.</span></label>
        <label>Support URL<input name="supportUrl" type="url" defaultValue={commerce?.supportUrl ?? ""} /></label>
        <label>Withdrawal portal URL<input name="withdrawalPortalUrl" type="url" defaultValue={commerce?.withdrawalPortalUrl ?? ""} /></label>
        <label className="span-two">WhatsApp order template<textarea name="whatsappMessageTemplate" required minLength={20} maxLength={1000} rows={7} defaultValue={commerce?.whatsappMessageTemplate ?? "Hello, I want to purchase Nazraa Live coins.\n\nMy User ID: {userId}\nAgency ID: {agencyId}\nSelected Package: {package}\nOrder ID: {orderId}\n\nPlease share payment details."} /></label>
        <label>Supported placeholders<span>{"{userId} {agencyId} {package} {orderId}"}</span><button className="primary-button" type="submit">Save commerce</button></label>
      </form>
    </Card>
  </>;
}
