import Image from "next/image";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { MasterAdjustmentForm } from "@/components/master-adjustment-form";
import { requirePermission } from "@/lib/auth/guard";
import { findAdjustmentTarget, listMasterAdjustments } from "@/lib/db/repositories/master-adjustments";
import { AdjustmentError } from "@/lib/finance/master-adjustment";
import { formatDate, formatNumber } from "@/lib/utils/format";
import tableStyles from "@/components/control-financial-table.module.css";

export const dynamic = 'force-dynamic';
export default async function MasterAdjustmentsPage({searchParams}:{searchParams:Promise<{q?:string;page?:string}>}) {
  const scope = await requirePermission('wallet.adjust');
  const {q='',page:rawPage} = await searchParams;
  const page=Math.max(1,Number.parseInt(rawPage??'1',10)||1);
  const history=await listMasterAdjustments(scope,page);
  let target:Awaited<ReturnType<typeof findAdjustmentTarget>>=null;
  let error='';
  if(q) try {target=await findAdjustmentTarget(scope,q);} catch(cause){if(cause instanceof AdjustmentError) error=cause.message;else throw cause;}
  return <><Link className="back-link" href="/dashboard/wallet">← Wallet & economy</Link>
    <SectionHeading title="Master balance adjustments" description="User/Host wallet corrections only. Existing transfer, commission and reward rules are unchanged. All timestamps below are IST." />
    <Card><form className="filter-bar" action="/dashboard/wallet/adjustments"><label>Exact User ID / Host ID<input name="q" defaultValue={q} required maxLength={80} /></label><button className="primary-button">Find account</button></form>
      {error?<p role="alert">{error}</p>:q&&!target?<EmptyState title="No account found" detail="Use the exact User ID or Host ID; names and phone numbers are not used for balance adjustments."/>:null}
      {target?<><div className="card-title"><div>{target.avatarUrl?<Image src={target.avatarUrl} alt="" width={56} height={56} unoptimized />:<span className="recipient-avatar"><UserRound size={28}/></span>}<h2>{target.name}</h2><p>User ID {target.publicId} · Host ID {target.hostId}</p></div><StatusBadge value={target.status}/></div>
        <dl className="detail-list"><div><dt>Agency</dt><dd>{target.agencyName??'Independent'} {target.agencyId??''}</dd></div><div><dt>Coins</dt><dd>{formatNumber(target.coins)}</dd></div><div><dt>Diamonds</dt><dd>{formatNumber(target.diamonds)}</dd></div></dl>
        <MasterAdjustmentForm key={target.id} target={target}/></>:null}
    </Card>
    <Card><h2>Master adjustment history</h2><p>Same single transactions also appear in the normal ledger. No paired duplicate financial entries.</p>
      {history.items.length?<div className="table-scroll"><table className={tableStyles.table}><thead><tr><th>Transaction</th><th>Target</th><th>Asset / action</th><th>Amount</th><th>Before → after</th><th>Reason / internal note</th><th>Performed by</th><th>IST date / time</th></tr></thead><tbody>{history.items.map(row=><tr key={row.id}>
        <td className="mono">{row.code}<small className="block">{row.id}</small></td><td>{row.name}<small className="block">{row.publicId}</small></td><td>{row.asset==='COIN'?'Coins':'Diamonds'} · {row.action}</td><td>{formatNumber(row.amount)}</td><td>{formatNumber(row.before)} → {formatNumber(row.after)}</td><td>{row.reason}{row.internalNote?<small className="block">Internal: {row.internalNote}</small>:null}</td><td>{row.actorName}<small className="block">Master · {row.actorId}</small></td><td>{formatDate(row.createdAt)} IST</td>
      </tr>)}</tbody></table></div>:<EmptyState title="No manual adjustments" detail="Completed Master adjustments appear here automatically."/>}
      <Pagination path="/dashboard/wallet/adjustments" page={page} hasNext={history.hasNext} query={{q}}/>
    </Card>
  </>;
}
