import Link from 'next/link';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePermission} from '@/lib/auth/guard';
import {countryManagement,assignCountryManager} from '@/lib/db/repositories/country-management';
import {Card,Notice,SectionHeading} from '@/components/ui';
import {CountrySelect} from '@/components/country-select';
import {formatNumber} from '@/lib/utils/format';

export const dynamic='force-dynamic';
async function assign(form:FormData){
  'use server';
  const scope=await requirePermission('accounts.roles');
  try{await assignCountryManager(scope,{accountId:String(form.get('accountId')??''),countryCode:String(form.get('countryCode')??''),reason:String(form.get('reason')??'')});}
  catch(e){redirect('/dashboard/countries?error='+encodeURIComponent(e instanceof Error&&/^(Only Master|Select |This branch)/.test(e.message)?e.message:'Country assignment could not be saved.'));}
  revalidatePath('/dashboard/countries');redirect('/dashboard/countries?success=Country+assignment+saved');
}
export default async function Countries({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const scope=await requirePermission('hierarchy.read');
  if(!['MASTER','COUNTRY_MANAGER'].includes(scope.account.role))redirect('/dashboard?error=forbidden');
  const p=await searchParams;
  let data:Awaited<ReturnType<typeof countryManagement>>;
  try{data=await countryManagement(scope,p.country);}catch{ return <Notice type="error">Country data is unavailable or outside your permitted country. Return to <Link href="/dashboard/countries">your Country Panel</Link>.</Notice>;}
  return <><SectionHeading title="Country Management" description={scope.isGlobal?'Global overview from canonical ISO country codes. Select a country for its operational records.':'Your assigned country and authorized hierarchy branch only.'}/>
    {p.error&&<Notice type="error">{p.error}</Notice>}{p.success&&<Notice type="success">{p.success}</Notice>}
    <Card><form><label>Country<select name="country" defaultValue={data.selected??''}>{scope.isGlobal&&<option value="">All countries</option>}{data.countries.map(c=><option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</select></label><button className="primary-button">View country</button></form></Card>
    <Card><div className="table-scroll"><table><thead><tr><th>Country</th><th>Country Managers</th><th>Users / Hosts</th><th>Agencies / Admins</th><th>Live Face / Party</th><th>Coins / Diamonds</th><th>Withdrawal activity</th></tr></thead><tbody>{data.countries.map(c=><tr key={c.code}>
      <td><Link href={`/dashboard/countries?country=${c.code}`}>{c.name}</Link><small className="block">{c.code}</small></td><td>{c.managers.length?c.managers.map(m=><div key={String(m.id)}>{String(m.full_name)} · {String(m.public_id)} <small>{String(m.status)}</small></div>):'Unassigned'}</td>
      <td>{formatNumber(c.users)} / {formatNumber(c.hosts)}</td><td>{formatNumber(c.agencies)} / {formatNumber(c.admins)}</td><td>{c.face} / {c.party}</td><td>{formatNumber(c.coins)} / {formatNumber(c.diamonds)}</td>
      <td>{c.payoutRequests} requests · {c.payoutPaid} paid / {c.payoutPending} pending<small className="block">Snapshot Host ${c.hostUsd.toFixed(2)} · Agency ${c.agencyUsd.toFixed(2)}</small></td></tr>)}</tbody></table></div><p>Balances are current available balances. Withdrawal amounts use existing durable distribution snapshots; records without a USD snapshot add no invented value. Targets are not configured in the current reporting system.</p></Card>
    {scope.isGlobal&&<Card><h2>Assign / change Country Manager</h2><p>Create a Country Manager through Team using the existing role. An occupied branch cannot be moved across countries here.</p><form action={assign} className="form-grid"><label>Country Manager<select name="accountId" required><option value="">Select active manager</option>{data.managers.filter(m=>m.status==='ACTIVE').map(m=><option key={String(m.id)} value={String(m.id)}>{String(m.full_name)} · {String(m.public_id)} · {String(m.country_code??'Unassigned')}</option>)}</select></label><label>Country<CountrySelect/></label><label>Reason<input name="reason" required minLength={5} maxLength={500}/></label><button className="primary-button">Save country assignment</button></form><Link href="/dashboard/accounts#create-account">Create a team account</Link></Card>}
    {data.selected&&<><Card><h2>Country team · latest 100</h2><div className="table-scroll"><table><thead><tr><th>ID</th><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>{data.team.map(a=><tr key={String(a.public_id)}><td>{String(a.public_id)}</td><td>{String(a.full_name)}</td><td>{String(a.role)}</td><td>{String(a.status)}</td></tr>)}</tbody></table></div></Card>
      <Card><h2>Country users / Hosts · latest 50</h2><div className="table-scroll"><table><thead><tr><th>ID</th><th>Name</th><th>Host</th><th>Status</th></tr></thead><tbody>{data.people.map(u=><tr key={String(u.public_id)}><td>{String(u.public_id)}</td><td>{String(u.full_name)}</td><td>{u.is_host?'Yes':'No'}</td><td>{String(u.account_status)}</td></tr>)}</tbody></table></div></Card>
      <Card><h2>Active country rooms · latest 30</h2>{data.activeRooms.length?data.activeRooms.map(r=><p key={String(r.room_code)}>{String(r.full_name)} · {String(r.room_type)} · {String(r.room_code)}</p>):<p>No active rooms in this authorized country scope.</p>}<Link href="/dashboard/monitoring">Monitor · user ID search · Device Block / Unblock</Link></Card></>}
  </>;
}
