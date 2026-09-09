import Link from "next/link";
import { submitLevelDefinitions } from "@/app/admin-actions";
import { Card, Notice, SectionHeading } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { managedLevelDefinitions, type ManagedLevelTrack } from "@/lib/db/repositories/level-administration";

export const dynamic = "force-dynamic";

export default async function LevelsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; track?: string; page?: string }>;
}) {
  const scope = await requirePermission("settings.manage");
  const params = await searchParams;
  const track: ManagedLevelTrack = params.track === "ANCHOR_INCOME" ? "ANCHOR_INCOME" : "CONSUMPTION";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const allDefinitions = await managedLevelDefinitions(track);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(allDefinitions.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const definitions = allDefinitions.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (scope.account.role !== "MASTER") {
    return <><SectionHeading title="Level progression" description="This is a Master-only economy control." /><Notice type="error">Only Master can change level progression.</Notice></>;
  }

  const otherTrack: ManagedLevelTrack = track === "CONSUMPTION" ? "ANCHOR_INCOME" : "CONSUMPTION";
  return <>
    <SectionHeading
      title="Level progression"
      description="Cumulative thresholds are server-authoritative and delivered to Nazraa as a versioned manifest. Existing users keep their displayed status; future progress follows the selected curve."
      action={<Link className="secondary-button" href={`/dashboard/levels?track=${otherTrack}`}>{otherTrack === "CONSUMPTION" ? "User levels" : "Host levels"}</Link>}
    />
    {params.success ? <Notice type="success">{params.success}</Notice> : null}
    {params.error ? <Notice type="error">{params.error}</Notice> : null}
    <Card className="settings-card">
      <div className="card-title"><div><h2>{track === "CONSUMPTION" ? "User / consumption levels" : "Actor / Host levels"}</h2><p>Thresholds are cumulative qualifying points, not a per-level amount. They must increase strictly. Labels, badge keys and enabled state are remote controls; perk data remains unchanged unless an existing perk feature consumes it.</p></div></div>
      <form action={submitLevelDefinitions} className="stack-form full-width">
        <input type="hidden" name="track" value={track} />
        <div className="table-wrap"><table><thead><tr><th>Level</th><th>Cumulative threshold</th><th>Badge key</th><th>Label</th><th>Availability</th></tr></thead><tbody>
          {definitions.map((definition) => <tr key={definition.level}>
            <td>Lv. {definition.level}</td>
            <td><input name={`threshold-${definition.level}`} type="number" min="0" step="1" required defaultValue={definition.threshold} /></td>
            <td><input name={`badge-${definition.level}`} minLength={2} maxLength={40} required defaultValue={definition.badgeKey} /></td>
            <td><input name={`label-${definition.level}`} minLength={2} maxLength={40} required defaultValue={definition.label} /></td>
            <td><select name={`enabled-${definition.level}`} defaultValue={String(definition.enabled)}><option value="true">Enabled</option><option value="false">Disabled</option></select></td>
          </tr>)}
        </tbody></table></div>
        <label>Change reason<input name="reason" minLength={5} maxLength={500} required placeholder="Why is this level range changing?" /></label>
        <button className="primary-button" type="submit">Save this range</button>
      </form>
      <nav className="pager" aria-label="Level pages">
        {safePage > 1 ? <Link href={`/dashboard/levels?track=${track}&page=${safePage - 1}`}>Previous</Link> : <span>Previous</span>}
        <span>Levels {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, allDefinitions.length)} of {allDefinitions.length}</span>
        {safePage < pageCount ? <Link href={`/dashboard/levels?track=${track}&page=${safePage + 1}`}>Next</Link> : <span>Next</span>}
      </nav>
    </Card>
  </>;
}
