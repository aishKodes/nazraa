import { Gift, Plus } from "lucide-react";
import { submitCreateGift, submitGiftStatus, submitGiftUpdate } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { GiftArtworkFields } from "@/components/gift-artwork-fields";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listGifts } from "@/lib/db/repositories/catalog";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const catalogueTypes = [
  ["VIRTUAL_GIFT", "Virtual Gift"],
  ["ENTRY_EFFECT", "Entry Effect"],
  ["AVATAR_FRAME", "Avatar / Seat Frame"],
  ["PROFILE_EFFECT", "Profile Effect"],
  ["CHAT_FRAME", "Chat Frame"],
  ["MEDAL", "Medal"],
  ["BADGE", "Badge"],
] as const;

function TypeOptions() {
  return <>{catalogueTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>;
}

export default async function GiftsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("gifts.read");
  const { error, success } = await searchParams;
  const gifts = await listGifts();
  const manage = can(scope.account.role, "gifts.manage");
  return <>
    <SectionHeading
      title="Mall catalogue"
      description="Manage gifts and entitlement-driven cosmetics without an APK release. Prices, validity, VIP grants, order and uploaded artwork are server controlled."
      action={manage ? <a className="primary-button" href="#new-gift"><Plus size={16} />New item</a> : undefined}
    />
    {success ? <Notice type="success">{success}</Notice> : null}
    {error ? <Notice type="error">{error}</Notice> : null}
    {manage ? <Card className="create-panel">
      <details id="new-gift">
        <summary><span><Gift size={18} /><b>Create Mall item</b></span><small>Upload artwork and configure the mobile entitlement.</small></summary>
        <form action={submitCreateGift} className="admin-form">
          <div className="form-grid">
            <label>Item key<input name="key" required pattern="[a-z0-9_]+" placeholder="aurora_avatar_frame" /></label>
            <label>Type<select name="catalogType" defaultValue="VIRTUAL_GIFT" required><TypeOptions /></select></label>
            <label>Name<input name="name" required /></label>
            <label>Category<input name="category" required placeholder="Premium" /></label>
            <label>Coin price<input name="coinPrice" type="number" min="1" required /></label>
            <label>Validity (days)<input name="validityDays" type="number" min="1" max="3650" defaultValue="30" required /></label>
            <label>VIP grant from tier <span>(optional)</span><select name="vipTierEligibility" defaultValue=""><option value="">Mall purchase only</option>{[1, 2, 3, 4, 5].map((tier) => <option key={tier} value={tier}>VIP {tier}+</option>)}</select></label>
            <label>Display order<input name="sortOrder" type="number" min="-9999" max="9999" defaultValue="0" required /></label>
            <label>Accent colour<input name="accentHex" type="color" defaultValue="#8a5cff" required /></label>
            <GiftArtworkFields requireArtwork />
          </div>
          <div className="form-submit"><p>Uploaded static or animated WebP is previewed and delivered by Nazraa. Virtual gifts remain the only items shown in the room gift tray.</p><button className="primary-button" type="submit">Create item</button></div>
        </form>
      </details>
    </Card> : null}
    <Card>{gifts.length ? <div className="table-scroll"><table>
      <thead><tr><th>Item</th><th>Artwork</th><th>Key</th><th>Type</th><th>Category</th><th className="align-right">Price</th><th>Validity</th><th>VIP grant</th><th>Order</th><th>Animation</th><th>Status</th>{manage ? <th>Action</th> : null}</tr></thead>
      <tbody>{gifts.map((gift) => <tr key={gift.id}>
        <td><b>{gift.name}</b></td>
        <td><span className="gift-artwork-chip" style={gift.visualUrl ? { backgroundImage: `url(${JSON.stringify(gift.visualUrl)})`, backgroundSize: "cover" } : undefined}>{gift.visualUrl ? "" : gift.emoji ?? "🎁"}</span></td>
        <td className="mono">{gift.key}</td>
        <td>{gift.catalogType.replaceAll("_", " ")}</td>
        <td>{gift.category}</td>
        <td className="align-right">{formatNumber(gift.coinPrice)} {gift.currency}</td>
        <td>{gift.catalogType === "VIRTUAL_GIFT" ? "—" : `${gift.validityDays} days`}</td>
        <td>{gift.vipTierEligibility == null ? "—" : `VIP ${gift.vipTierEligibility}+`}</td>
        <td>{gift.sortOrder}</td>
        <td>{gift.animationKey ? `${String(gift.effectConfig.assetType ?? "Animation").replaceAll("_", " ")} • ${String(gift.effectConfig.presentationTier ?? "MEDIUM")}` : String(gift.effectConfig.presentationTier ?? "Static")}</td>
        <td><StatusBadge value={gift.active ? "ACTIVE" : "DISABLED"} /></td>
        {manage ? <td><div className="account-actions">
          <details className="row-action gift-edit"><summary>Edit</summary><form action={submitGiftUpdate}>
            <input type="hidden" name="id" value={gift.id} />
            <label>Name<input name="name" defaultValue={gift.name} required /></label>
            <label>Type<select name="catalogType" defaultValue={gift.catalogType} required><TypeOptions /></select></label>
            <label>Category<input name="category" defaultValue={gift.category} required /></label>
            <label>Coin price<input name="coinPrice" type="number" min="1" defaultValue={gift.coinPrice} required /></label>
            <label>Validity (days)<input name="validityDays" type="number" min="1" max="3650" defaultValue={gift.validityDays} required /></label>
            <label>VIP grant from tier<select name="vipTierEligibility" defaultValue={gift.vipTierEligibility ?? ""}><option value="">Mall purchase only</option>{[1, 2, 3, 4, 5].map((tier) => <option key={tier} value={tier}>VIP {tier}+</option>)}</select></label>
            <label>Display order<input name="sortOrder" type="number" min="-9999" max="9999" defaultValue={gift.sortOrder} required /></label>
            <label>Accent colour<input name="accentHex" type="color" defaultValue={gift.accentHex} required /></label>
            <GiftArtworkFields currentEmoji={gift.emoji} currentImageUrl={gift.visualUrl} currentAnimationKey={gift.animationKey} currentEffectConfig={gift.effectConfig} />
            <label>Change reason<input name="reason" required minLength={5} placeholder="Why is this changing?" /></label>
            <button className="secondary-button" type="submit">Save item</button>
          </form></details>
          <form action={submitGiftStatus}><input type="hidden" name="id" value={gift.id} /><input type="hidden" name="active" value={String(!gift.active)} /><button className="table-link button-link" type="submit">{gift.active ? "Disable / archive" : "Restore / enable"}</button></form>
        </div></td> : null}
      </tr>)}</tbody>
    </table></div> : <EmptyState title="No Mall items configured" detail="Create an item for the backend-controlled mobile catalogue." />}</Card>
  </>;
}
