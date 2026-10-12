import { Card } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";
import type { hostOperationalActivity } from "@/lib/db/repositories/host-operations";
export function HostOperationalActivity({data,showCoins=false}:{data:Awaited<ReturnType<typeof hostOperationalActivity>>[number];showCoins?:boolean}) {
  return <Card><h2>Operational activity · 30 days</h2><dl className="detail-list">
    <div><dt>Agency</dt><dd>{data.agencyName??'Independent'} {data.agencyId??''}</dd></div>
    <div><dt>Admin / BD</dt><dd>{data.adminName??'Unassigned'} {data.adminId??''}</dd></div>
    <div><dt>Total Diamonds</dt><dd>{formatNumber(data.diamonds)}</dd></div>
    {showCoins ? <div><dt>Coins</dt><dd>{formatNumber(data.coins)}</dd></div> : null}
    <div><dt>Face Live hours</dt><dd>{(data.faceSeconds/3600).toFixed(2)}</dd></div>
    <div><dt>Face Valid Days</dt><dd>{data.faceValidDays??'Not configured'}</dd></div>
    <div><dt>Face working status</dt><dd>{data.faceWorking?'Working':'No recorded activity'}</dd></div>
    <div><dt>Face gifting Diamonds</dt><dd>{formatNumber(data.faceGiftDiamonds)}</dd></div>
    <div><dt>Party Live hours</dt><dd>{(data.partySeconds/3600).toFixed(2)}</dd></div>
    <div><dt>Party activity status</dt><dd>{data.partyWorking?'Working':'No recorded activity'}</dd></div>
    <div><dt>Party gifting Diamonds</dt><dd>{formatNumber(data.partyGiftDiamonds)}</dd></div>
    <div><dt>Party Valid Days</dt><dd>Canonical rule not configured</dd></div>
    <div><dt>Party Board completed days / hours</dt><dd>Canonical completion records not configured</dd></div>
    <div><dt>Target status</dt><dd>Target source not configured</dd></div>
  </dl></Card>;
}
