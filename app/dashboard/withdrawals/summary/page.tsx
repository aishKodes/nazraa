import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { Card, EmptyState, Notice, SectionHeading } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { countryName } from "@/lib/countries";
import { withdrawalSummary,withdrawalSummaryCards,type WithdrawalSummaryInput } from "@/lib/db/repositories/withdrawal-summary";
import { formatDate,formatNumber } from "@/lib/utils/format";

export const dynamic="force-dynamic";
const path='/dashboard/withdrawals/summary';
function dollars(value:unknown){return value==null?'Not recorded':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));}
function href(query:Record<string,string>,changes:Record<string,string|undefined>={}) {
  const params=new URLSearchParams(query);
  for(const [key,value] of Object.entries(changes)){if(value)params.set(key,value);else params.delete(key);}
  return `${path}?${params}`;
}
export default async function WithdrawalSummaryPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const scope=await requirePermission('withdrawals.read'); if(scope.account.role!=='MASTER')notFound();
  const raw=await searchParams;
  const query=Object.fromEntries(Object.entries(raw).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  const input:WithdrawalSummaryInput={...query,page:Number(query.page??1)};
  const level=input.agency?'detail':input.country?'agency':'country';
  const [data,cards]=await Promise.all([withdrawalSummary(scope,input,level),withdrawalSummaryCards(scope,input)]);
  const exportQuery=new URLSearchParams(query); exportQuery.delete('page');
  return <>
    <SectionHeading title="Agency-wise Withdrawal & Commission Summary" description="Read-only saved payouts and commission snapshots. Filters use request dates in Asia/Kolkata; no settlement or exchange rule is changed." />
    <Link href="/dashboard/withdrawals" className="table-link">← Existing Withdrawals</Link>
    <div className="metric-grid">
      {[['Processed withdrawal (Diamonds)',formatNumber(Number(cards.processed_diamonds??0))],['Processed withdrawal (USD)',dollars(cards.processed_usd)],['Agency commission paid/accrued (USD)',dollars(cards.agency_commission_usd)],['Pending requests',formatNumber(Number(cards.pending_requests??0))],['Active countries',formatNumber(Number(cards.countries??0))],['Participating Agencies',formatNumber(Number(cards.agencies??0))]].map(([label,value])=><Card key={label}><small>{label}</small><h2>{value}</h2></Card>)}
    </div>
    {Number(cards.missing_distribution_snapshots)>0?<Notice>{Number(cards.missing_distribution_snapshots)} completed requests have no saved distribution snapshot. Their Diamonds are included, but no USD/commission amount is invented.</Notice>:null}
    <Card><form className="filter-bar" action={path}>
      <label>Period<select name="period" defaultValue={input.period??'month'}><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option><option value="custom">Custom Range</option></select></label>
      <label>From (IST)<input name="from" type="date" defaultValue={input.from??''}/></label>
      <label>To (IST)<input name="to" type="date" defaultValue={input.to??''}/></label>
      <label>Country code<input name="country" pattern="[A-Z]{2}|UNKNOWN" placeholder="IN" defaultValue={input.country??''}/></label>
      <label>Agency ID<input name="agency" placeholder="6-digit ID" defaultValue={input.agency??''}/></label>
      <label>Status<select name="status" defaultValue={input.status??''}><option value="">All</option>{['PENDING','UNDER_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELLED'].map(status=><option key={status}>{status}</option>)}</select></label>
      <label>Agency / Host search<input name="q" maxLength={120} defaultValue={input.q??''} placeholder="ID or name"/></label>
      <button className="primary-button" type="submit">Apply filters</button>
    </form>
    <div className="filter-bar">{['country','detail'].flatMap(kind=>['xlsx','csv'].map(format=><a key={`${kind}-${format}`} className="secondary-button" href={`/api/reports/withdrawal-summary?${exportQuery}&kind=${kind}&format=${format}`}>Export {kind==='country'?'Country Summary':'Detailed Breakdown'} · {format.toUpperCase()}</a>))}</div></Card>
    <nav className="filter-bar" aria-label="Withdrawal hierarchy"><Link href={href(query,{country:undefined,agency:undefined,page:undefined})}>Countries</Link>{input.country?<Link href={href(query,{agency:undefined,page:undefined})}>→ {countryName(input.country)}</Link>:null}{input.agency?<span>→ Agency {input.agency}</span>:null}</nav>
    <Card>{data.items.length?<div className="table-scroll"><table>
      <thead><tr>{(level==='country'?['Country','Agencies','Hosts','Processed Diamonds','Processed USD','Agency Commission USD','Open']:level==='agency'?['Agency','Hosts','Host Payouts USD','Commission Earned USD','Net Balance','Open']:['Host','Withdrawal','Diamonds','Host USD','Agency USD','Date (IST)','Status','Payment Mode']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.items.map((row,index)=><tr key={String(row.id??row.agency_id??row.country??index)}>
        {level==='country'?<><td>{countryName(String(row.country))}</td><td>{Number(row.agencies)}</td><td>{Number(row.hosts)}</td><td>{formatNumber(Number(row.processed_diamonds??0))}</td><td>{dollars(row.processed_usd)}</td><td>{dollars(row.agency_commission_usd)}</td><td><Link className="table-link" href={href(query,{country:String(row.country),agency:undefined,page:undefined})}>Agencies →</Link></td></>:null}
        {level==='agency'?<><td><b>{String(row.agency_name??'Unassigned')}</b><small className="mono block">{String(row.agency_public_id??'—')}</small></td><td>{Number(row.hosts)}</td><td>{dollars(row.host_payout_usd)}</td><td>{dollars(row.agency_commission_usd)}</td><td>Not recorded in a canonical Agency balance</td><td><Link className="table-link" href={href(query,{agency:row.agency_id?String(row.agency_id):'UNASSIGNED',page:undefined})}>Hosts / transactions →</Link></td></>:null}
        {level==='detail'?<><td><b>{String(row.host_name)}</b><small className="mono block">{String(row.host_public_id)}</small></td><td className="mono">{String(row.withdrawal_code)}</td><td>{formatNumber(Number(row.amount))}</td><td>{dollars(row.host_usd)}</td><td>{dollars(row.agency_usd)}</td><td>{formatDate(row.requested_at as string)}</td><td>{String(row.status)}</td><td>{String(row.payment_channel??'Not recorded')}</td></>:null}
      </tr>)}</tbody>
    </table></div>:<EmptyState title="No matching withdrawals" detail="Change the filters. No payout or commission records are synthesized."/>}
    <Pagination path={path} page={data.page} hasNext={data.hasNext} query={query}/></Card>
    <p className="footnote">Country mapping uses the retained hierarchy’s Country account when present, then the Agency/user country. Unsnapshotted historical country changes cannot be reconstructed exactly. Detail rows are loaded only after opening an Agency.</p>
  </>;
}
