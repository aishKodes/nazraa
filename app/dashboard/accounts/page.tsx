import Link from "next/link";
import { FileLock2, Plus, Search, UserCog } from "lucide-react";
import { submitCreateAccount, submitPasswordReset } from "@/app/admin-actions";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { canManageRole, roleLabel } from "@/lib/auth/role-hierarchy";
import { listParentOptions, listPlatformAccountsPage, rolesCreatableBy } from "@/lib/db/repositories/administration";
import { formatDate } from "@/lib/utils/format";
import { CountrySelect } from "@/components/country-select";
import { countryName } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; success?: string; q?: string; page?: string; create?: string }>;
}) {
  const scope = await requirePermission("accounts.read");
  const { error, success, q, page: rawPage, create } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const [result, parents] = await Promise.all([
    listPlatformAccountsPage(scope, { page, search: q }),
    listParentOptions(scope),
  ]);
  const creatable = rolesCreatableBy(scope.account.role);
  const canCreate = can(scope.account.role, "accounts.create") && creatable.length > 0;
  const canManage = can(scope.account.role, "accounts.manage");

  return <>
    <SectionHeading
      title="Team accounts"
      description="Create and manage only the roles below your branch. App users continue to register in the mobile app."
      action={canCreate ? <a className="primary-button" href="#create-account"><Plus size={16} />Create account</a> : undefined}
    />
    {success ? <Notice type="success">{success}</Notice> : null}
    {error ? <Notice type="error">{error}</Notice> : null}

    {canCreate ? <Card className="create-panel">
      <details id="create-account" open={create === "1"}>
        <summary><span><UserCog size={18} /><b>Create a panel account</b></span><small>Only roles allowed under your branch are shown</small></summary>
        <form action={submitCreateAccount} className="admin-form">
          <div className="form-grid">
            <label>Account type<select name="accountType" required defaultValue=""><option value="" disabled>Select role</option>{creatable.map((role) => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></label>
            <label>Full name<input name="fullName" required maxLength={120} /></label>
            <label>Country<CountrySelect defaultValue={parents.find((parent) => parent.id === scope.account.id)?.country ?? "IN"} /></label>
            <label>Mobile<input name="mobile" inputMode="tel" placeholder="+919876543210" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Existing app user ID <span>(optional)</span><input name="applicationUserId" /></label>
            <label>Parent account<select name="requestedParentId" defaultValue=""><option value="">Automatic when allowed</option>{parents.map((parent) => <option value={parent.id} key={parent.id}>{parent.displayRole} · {parent.name} · {parent.code}</option>)}</select></label>
            <label>Temporary password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
            <label>ID front <span>(optional)</span><input name="idFront" type="file" accept="image/jpeg,image/png,application/pdf" /></label>
            <label>ID back <span>(optional)</span><input name="idBack" type="file" accept="image/jpeg,image/png,application/pdf" /></label>
            <label>Profile photo <span>(optional)</span><input name="profilePhoto" type="file" accept="image/jpeg,image/png" /></label>
          </div>
          <div className="form-submit"><p><FileLock2 size={15} />Documents are encrypted and never receive a public URL.</p><button className="primary-button" type="submit">Create account</button></div>
        </form>
      </details>
    </Card> : null}

    <Card>
      <form className="filter-bar" action="/dashboard/accounts">
        <label className="search-field"><Search size={17} /><input name="q" defaultValue={q} placeholder="Search ID, name, phone, or email" /><button className="primary-button" type="submit">Search</button></label>
        <span>Page {result.page}</span>
      </form>
      {result.items.length ? <div className="table-scroll"><table><thead><tr><th>Account</th><th>Management ID</th><th>Role</th><th>Parent</th><th>Country</th><th>Documents</th><th>Last login</th><th>Status</th>{canManage ? <th>Manage</th> : null}</tr></thead><tbody>{result.items.map((account) => <tr key={account.id}>
        <td data-label="Account"><Link className="table-link" href={`/dashboard/accounts/${account.id}`}><b>{account.name}</b></Link><small className="block">{account.email ?? account.mobile ?? "No contact"}</small></td>
        <td data-label="Management ID" className="mono">{account.code}</td><td data-label="Role">{account.displayRole}</td><td data-label="Parent">{account.parentName ?? "Platform root"}</td><td data-label="Country">{countryName(account.country)}</td><td data-label="Documents">{account.documentCount}</td><td data-label="Last login">{formatDate(account.lastLoginAt)}</td><td data-label="Status"><StatusBadge value={account.status} /></td>
        {canManage ? <td data-label="Manage">{canManageRole(scope.account.role, account.role) && account.id !== scope.account.id && account.status !== "DISABLED" ? <div className="account-actions">
          <Link className="table-link" href={`/dashboard/accounts/${account.id}`}>Edit account</Link>
          {can(scope.account.role, "accounts.roles") ? <Link className="table-link" href={`/dashboard/accounts/${account.id}#change-role`}>Change role</Link> : null}
          <Link className="table-link" href={`/dashboard/accounts/${account.id}#account-status`}>{account.status === "ACTIVE" ? "Suspend" : "Activate"}</Link>
          <details className="row-action"><summary>Password</summary><form action={submitPasswordReset}><input type="hidden" name="accountId" value={account.id} /><input name="password" type="password" minLength={8} required placeholder="Temporary password" /><input name="reason" required minLength={5} placeholder="Reason" /><button type="submit" className="secondary-button">Reset</button></form></details>
        </div> : "—"}</td> : null}
      </tr>)}</tbody></table></div> : <EmptyState title="No team accounts" detail="Try another search or create the first account allowed by your role." />}
      <Pagination path="/dashboard/accounts" page={result.page} hasNext={result.hasNext} query={{ q }} />
    </Card>
  </>;
}
