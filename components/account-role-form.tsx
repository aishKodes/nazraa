"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { submitAccountRoleChange } from "@/app/admin-actions";
import { CountrySelect } from "@/components/country-select";
import { isParentRoleValid, roleLabel, rolesAssignableBy, validParentRoles } from "@/lib/auth/role-hierarchy";
import { roleChangeOptions, type RoleDescendant, type RoleParent } from "@/lib/auth/role-change-options";
import { countryName } from "@/lib/countries";
import type { Role } from "@/types/platform";

export function AccountRoleForm({ actorRole, account, parents, descendants }: {
  actorRole: Role;
  account: { id: string; role: Role; parentId: string | null; country: string | null };
  parents: RoleParent[];
  descendants: RoleDescendant[];
}) {
  const roles = rolesAssignableBy(actorRole);
  const [role, setRole] = useState<Role>(roles.includes(account.role) ? account.role : roles[0]);
  const [parentChoice, setParentChoice] = useState<string | null>(null);
  const [childChoices, setChildChoices] = useState<Partial<Record<Role, string>>>({});
  const [reason, setReason] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [supporting, setSupporting] = useState({ cmName: "", cmPassword: "", country: "IN", adminName: "", adminPassword: "" });
  const [state, action, pending] = useActionState(submitAccountRoleChange, { error: null });
  const options = roleChangeOptions(account, role, parents, descendants);
  const canCreateCM = actorRole === "MASTER" && role === "SUPER_ADMIN";
  const parentId = parentChoice ?? (options.suggestedParentId || (!options.validParents.length && canCreateCM ? "NEW_COUNTRY_MANAGER" : ""));
  const childValues = Object.fromEntries(options.childRoles.map((childRole) => {
    const candidates = options.childParents[childRole] ?? [];
    // Prefer keeping the team inside this account under a retained Admin/BD.
    const retained = candidates.find((parent) => descendants.some((child) => child.id === parent.id));
    return [childRole, childChoices[childRole] ?? retained?.id ?? (candidates.length === 1 ? candidates[0].id : !candidates.length && role === "SUPER_ADMIN" && isParentRoleValid(childRole, "ADMIN") ? "NEW_ADMIN" : "")];
  })) as Partial<Record<Role, string>>;
  const needsAdmin = Object.values(childValues).includes("NEW_ADMIN");
  const missingParent = !options.validParents.length && !canCreateCM;
  const missingChild = options.childRoles.some((childRole) => !options.childParents[childRole]?.length && !(role === "SUPER_ADMIN" && isParentRoleValid(childRole, "ADMIN")));

  function changeRole(value: Role) {
    setRole(value); setParentChoice(null); setChildChoices({}); setConfirmed(false);
  }

  return <form action={action} className="stack-form role-change-form">
    <input type="hidden" name="accountId" value={account.id} />
    <input type="hidden" name="expectedRole" value={account.role} />
    <label>New role<select name="role" value={role} onChange={(event) => changeRole(event.target.value as Role)}>{roles.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
    <label>Assign under<select name="parentAccountId" required value={parentId} onChange={(event) => { setParentChoice(event.target.value); setConfirmed(false); }}>
      <option value="" disabled>Select parent</option>
      {options.validParents.map((parent) => <option key={parent.id} value={parent.id}>{roleLabel(parent.role)} · {parent.name} · {parent.code}</option>)}
      {canCreateCM ? <option value="NEW_COUNTRY_MANAGER">Create a new Country Manager</option> : null}
    </select></label>
    {parentId === "NEW_COUNTRY_MANAGER" ? <fieldset className="role-support-fields"><legend>New Country Manager</legend>
      <p>Create a Country Manager above this Super Admin in the same save.</p>
      <label>Country Manager name<input name="newCountryManagerName" required minLength={2} maxLength={120} value={supporting.cmName} onChange={(event) => setSupporting({ ...supporting, cmName: event.target.value })} /></label>
      <label>Country Manager password<input name="newCountryManagerPassword" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={supporting.cmPassword} onChange={(event) => setSupporting({ ...supporting, cmPassword: event.target.value })} /></label>
      {account.country ? <><input type="hidden" name="newCountryManagerCountry" value={account.country.toUpperCase()} /><p>Country: {countryName(account.country)}</p></> : <label>Country<CountrySelect name="newCountryManagerCountry" value={supporting.country} onChange={(event) => setSupporting({ ...supporting, country: event.target.value })} /></label>}
    </fieldset> : null}
    {options.childRoles.map((childRole) => <label key={childRole}>Move existing {roleLabel(childRole)} accounts under<select name={`childParent_${childRole}`} required value={childValues[childRole] ?? ""} onChange={(event) => { setChildChoices({ ...childChoices, [childRole]: event.target.value }); setConfirmed(false); }}>
      <option value="" disabled>Select their new parent</option>
      {(options.childParents[childRole] ?? []).map((parent) => <option key={parent.id} value={parent.id}>{roleLabel(parent.role)} · {parent.name} · {parent.code}</option>)}
      {role === "SUPER_ADMIN" && isParentRoleValid(childRole, "ADMIN") ? <option value="NEW_ADMIN">Create a new Admin under this Super Admin</option> : null}
    </select><small>Existing accounts, hosts and balances are preserved.</small></label>)}
    {needsAdmin ? <fieldset className="role-support-fields"><legend>New Admin for the existing team</legend>
      <p>The new Admin will report to this account after its promotion to Super Admin.</p>
      <label>New Admin name<input name="newAdminName" required minLength={2} maxLength={120} value={supporting.adminName} onChange={(event) => setSupporting({ ...supporting, adminName: event.target.value })} /></label>
      <label>New Admin password<input name="newAdminPassword" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={supporting.adminPassword} onChange={(event) => setSupporting({ ...supporting, adminPassword: event.target.value })} /></label>
    </fieldset> : null}
    {missingParent || missingChild ? <p className="notice notice-info">{missingParent ? `No active ${validParentRoles(role).map(roleLabel).join(" or ")} is available in this country and branch.` : "No compatible parent is available for the existing team."} <Link className="table-link" href="/dashboard/accounts?create=1#create-account">Create the required team account</Link>, then return here.</p> : null}
    <label>Reason<input name="reason" required minLength={5} maxLength={500} value={reason ?? `Change ${roleLabel(account.role)} to ${roleLabel(role)}`} onChange={(event) => setReason(event.target.value)} /></label>
    <label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirm this role change and the assignments shown above</label>
    {state.error ? <p className="notice notice-error" role="alert">{state.error}</p> : null}
    <button className="primary-button" type="submit" disabled={pending || missingParent || missingChild}>{pending ? "Saving role…" : "Save role change"}</button>
    <p className="form-note">The management ID, password and wallet stay the same. New permissions apply on the account’s next request.</p>
  </form>;
}
