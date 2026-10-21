import Link from "next/link";
import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { MasterAllocationSearch } from "@/components/master-allocation-search";
import { requirePermission } from "@/lib/auth/guard";
import { listMasterAdjustments } from "@/lib/db/repositories/master-adjustments";
import { formatDate, formatNumber } from "@/lib/utils/format";
import tableStyles from "@/components/control-financial-table.module.css";

export const dynamic = 'force-dynamic';
export default async function MasterAdjustmentsPage({searchParams}:{searchParams:Promise<{q?:string;history?:string;page?:string}>}) {
  const scope = await requirePermission('wallet.adjust');
  const {q='',history:historySearch='',page:rawPage} = await searchParams;
  const page=Math.max(1,Number.parseInt(rawPage??'1',10)||1);
  const history=await listMasterAdjustments(scope,page,historySearch);
  return <><Link className="back-link" href="/dashboard/wallet">← Wallet & economy</Link>
    <SectionHeading title="Coin / Diamond Allocation" description="Master only. Search an ID, select its wallet, then add or remove with confirmation. Existing economy rules are unchanged." />
    <Card><MasterAllocationSearch initialQuery={q}/></Card>
    <Card><h2>Recent allocations</h2><p>Authoritative ledger activity · Asia/Kolkata (IST)</p>
      <form className="filter-bar" action="/dashboard/wallet/adjustments"><label>History: User ID / transaction ID<input name="history" defaultValue={historySearch} maxLength={80} placeholder="Exact ID or transaction code"/></label><button className="secondary-button">Search history</button>{historySearch?<Link href="/dashboard/wallet/adjustments">Clear filter</Link>:null}</form>
      {history.items.length?<div className="table-scroll"><table className={tableStyles.table}><thead><tr><th>Transaction</th><th>Target</th><th>Asset / action</th><th>Amount</th><th>Before → after</th><th>Reason / internal note</th><th>Performed by</th><th>IST date / time</th></tr></thead><tbody>{history.items.map(row=><tr key={row.id}>
        <td className="mono">{row.code}<small className="block">{row.id}</small></td><td>{row.name}<small className="block">{row.publicId} · {row.role.replaceAll('_',' ')} · {row.ownerType==='PLATFORM_ACCOUNT'?'Platform':'App'}</small></td><td>{row.asset==='COIN'?'Coins':'Diamonds'} · {row.action}</td><td>{row.action==='Add'?'+':'−'}{formatNumber(row.amount)}</td><td>{formatNumber(row.before)} → <strong>{formatNumber(row.after)}</strong></td><td>{row.reason}{row.internalNote?<small className="block">Internal: {row.internalNote}</small>:null}</td><td>{row.actorName}<small className="block">Master · {row.actorId}</small></td><td>{formatDate(row.createdAt)} IST</td>
      </tr>)}</tbody></table></div>:<EmptyState title="No manual adjustments" detail="Completed Master adjustments appear here automatically."/>}
      <Pagination path="/dashboard/wallet/adjustments" page={page} hasNext={history.hasNext} query={{history:historySearch}}/>
    </Card>
  </>;
}
