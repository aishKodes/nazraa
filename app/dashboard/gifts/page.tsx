import { Gift, Plus } from "lucide-react";
import { submitCreateGift, submitGiftStatus } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listGifts } from "@/lib/db/repositories/catalog";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function GiftsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("gifts.read"); const { error, success } = await searchParams; const gifts = await listGifts(); const manage = can(scope.account.role, "gifts.manage");
  return <><SectionHeading title="Gift catalogue" description="Manage current gift availability. Historic gift transactions keep their original price snapshots." action={manage ? <a className="primary-button" href="#new-gift"><Plus size={16} />New gift</a> : undefined} />{success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    {manage ? <Card className="create-panel"><details id="new-gift"><summary><span><Gift size={18} /><b>Create gift</b></span><small>New pricing affects future sends only.</small></summary><form action={submitCreateGift} className="admin-form"><div className="form-grid"><label>Gift key<input name="key" required pattern="[a-z0-9_]+" placeholder="golden_rose" /></label><label>Name<input name="name" required /></label><label>Category<input name="category" required placeholder="Popular" /></label><label>Coin price<input name="coinPrice" type="number" min="1" required /></label><label>Visual URL<input name="visualUrl" type="url" placeholder="https://…" /></label><label>Animation key<input name="animationKey" /></label></div><div className="form-submit"><span /><button className="primary-button" type="submit">Create gift</button></div></form></details></Card> : null}
    <Card>{gifts.length ? <div className="table-scroll"><table><thead><tr><th>Gift</th><th>Key</th><th>Category</th><th className="align-right">Coin price</th><th>Animation</th><th>Status</th>{manage ? <th>Action</th> : null}</tr></thead><tbody>{gifts.map((gift) => <tr key={gift.id}><td><b>{gift.name}</b></td><td className="mono">{gift.key}</td><td>{gift.category}</td><td className="align-right">{formatNumber(gift.coinPrice)}</td><td>{gift.animationKey ?? "—"}</td><td><StatusBadge value={gift.active ? "ACTIVE" : "DISABLED"} /></td>{manage ? <td><form action={submitGiftStatus}><input type="hidden" name="id" value={gift.id} /><input type="hidden" name="active" value={String(!gift.active)} /><button className="table-link button-link" type="submit">{gift.active ? "Disable" : "Enable"}</button></form></td> : null}</tr>)}</tbody></table></div> : <EmptyState title="No gifts configured" detail="Create the first gift that the mobile app can fetch from the public configuration endpoint." />}</Card>
  </>;
}
