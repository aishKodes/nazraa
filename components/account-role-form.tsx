"use client";

import { useState } from "react";
import { submitAccountRoleChange } from "@/app/admin-actions";
import { isParentRoleValid, roleLabel, rolesAssignableBy } from "@/lib/auth/role-hierarchy";
import type { Role } from "@/types/platform";

type Parent = { id: string; role: Role; name: string; code: string; country: string | null };

export function AccountRoleForm({ actorRole, account, parents, childRoles }: {
  actorRole: Role;
  account: { id: string; role: Role; parentId: string | null; country: string | null };
  parents: Parent[];
  childRoles: Role[];
}) {
  const roles = rolesAssignableBy(actorRole);
  const [role, setRole] = useState<Role>(roles.includes(account.role) ? account.role : roles[0]);
  const candidates = parents.filter((parent) => parent.id !== account.id && (!account.country || !parent.country || parent.role === "MASTER" || parent.country === account.country));
  const validParents = candidates.filter((parent) => isParentRoleValid(role, parent.role));
  const invalidChildren = childRoles.filter((child) => !isParentRoleValid(child, role));
  const childParents = candidates.filter((parent) => invalidChildren.every((child) => isParentRoleValid(child, parent.role)));
  const ready = validParents.length > 0 && (!invalidChildren.length || childParents.length > 0);

  return <form action={submitAccountRoleChange} className="stack-form">
    <input type="hidden" name="accountId" value={account.id} />
    <label>New role<select name="role" value={role} onChange={(event) => setRole(event.target.value as Role)}>{roles.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
    <label>Assign under<select key={role} name="parentAccountId" required defaultValue={validParents.some((parent) => parent.id === account.parentId) ? account.parentId! : validParents.length === 1 ? validParents[0].id : ""}><option value="" disabled>Select parent</option>{validParents.map((parent) => <option key={parent.id} value={parent.id}>{roleLabel(parent.role)} · {parent.name} · {parent.code}</option>)}</select></label>
    {invalidChildren.length ? <label>Move existing {invalidChildren.map(roleLabel).join(" / ")} accounts under<select key={`children-${role}`} name="childParentId" required defaultValue=""><option value="" disabled>Select their new parent</option>{childParents.map((parent) => <option key={parent.id} value={parent.id}>{roleLabel(parent.role)} · {parent.name} · {parent.code}</option>)}</select><small>Existing accounts and host data are preserved. This move is saved with the role change.</small></label> : null}
    {!ready ? <p className="form-note">Create a suitable parent account in this country first, then return here.</p> : null}
    <label>Reason<input name="reason" required minLength={5} maxLength={500} placeholder="Reason for role change" /></label>
    <label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm role and hierarchy change</label>
    <button className="primary-button" type="submit" disabled={!ready}>Save role change</button>
    <p className="form-note">The management ID, password, and wallet stay the same. Permissions update on the account’s next request.</p>
  </form>;
}
