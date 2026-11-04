import {redirect} from 'next/navigation';
import {requirePermission} from '@/lib/auth/guard';
import {globalManagement} from '@/lib/db/repositories/global-management';
import {Card,SectionHeading,StatusBadge} from '@/components/ui';
import {CountrySelect} from '@/components/country-select';
import {submitCreateAccount} from '@/app/admin-actions';
import {ManagerForm,GroupForm} from './forms';
export const dynamic='force-dynamic';
export default async function GlobalManagers(){
 const scope=await requirePermission('accounts.roles');if(scope.account.role!=='MASTER')redirect('/dashboard?error=forbidden');
 const data=await globalManagement(scope);
 return <><SectionHeading title="Global Managers & Country Groups" description="Reusable restricted panels. Access is the intersection of assigned countries and the manager’s own team. Only Master configures assignments."/>
 <Card><details><summary>Create Global Manager</summary><form action={submitCreateAccount} className="form-grid"><input name="mobile" type="hidden" value=""/><input name="requestedParentId" type="hidden" value=""/><input name="accountType" type="hidden" value="GLOBAL_MANAGER"/><label>Name<input name="fullName" required maxLength={120}/></label><label>Nazraa account ID<input name="applicationUserId" required/></label><label>Primary country (profile only)<CountrySelect/></label><label>Email<input name="email" type="email"/></label><label>Temporary Control password<input name="password" type="password" required minLength={8} autoComplete="new-password"/></label><button className="primary-button">Create Global Manager account</button><p>Assign countries/groups and team after creation. An unassigned manager has no country data access.</p></form></details></Card>
 {data.managers.map(m=><Card key={`${m.id}:${m.version}`}><h2>{m.name} · {m.publicId} <StatusBadge value={m.status}/></h2><p>Assignment version {m.version} · linked app account {m.applicationUserPublicId??'not linked'}</p><details><summary>Edit country and team scope</summary><ManagerForm data={data} manager={m}/></details></Card>)}
 <Card><h2>Country groups</h2><p>Editing an active group updates every assigned manager’s scope automatically. No sovereign country records are duplicated.</p>{data.groups.map(g=><details key={`${g.id}:${g.version}`}><summary>{g.name} · {g.countries.length} countries · {g.active?'Active':'Inactive'}</summary><GroupForm data={data} group={g}/></details>)}<details><summary>Create country group</summary><GroupForm data={data}/></details></Card></>;
}
