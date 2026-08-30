import { isParentRoleValid } from "@/lib/auth/role-hierarchy";
import type { Role } from "@/types/platform";

export type RoleParent = { id: string; role: Role; name: string; code: string; country: string | null; parentId: string | null };
export type RoleDescendant = { id: string; role: Role; branchRole: Role; depth: number };

export function roleChangeOptions(account: { id: string; parentId: string | null; country: string | null }, role: Role, parents: RoleParent[], descendants: RoleDescendant[]) {
  const sameCountry = parents.filter((parent) => parent.id !== account.id && (!account.country || !parent.country || parent.role === "MASTER" || parent.country.toUpperCase() === account.country.toUpperCase()));
  const subtree = new Set(descendants.map((child) => child.id));
  const validParents = sameCountry.filter((parent) => !subtree.has(parent.id) && isParentRoleValid(role, parent.role));
  const ancestors: string[] = [];
  let next = account.parentId;
  while (next && !ancestors.includes(next)) {
    ancestors.push(next);
    next = parents.find((parent) => parent.id === next)?.parentId ?? null;
  }
  const suggestedParentId = ancestors.find((id) => validParents.some((parent) => parent.id === id)) ?? (validParents.length === 1 ? validParents[0].id : "");
  const moving = descendants.filter((child) => !isParentRoleValid(child.branchRole, role));
  const excluded = new Set(moving.map((child) => child.id));
  const childRoles = [...new Set(moving.filter((child) => child.depth === 1).map((child) => child.role))];
  const childParents = Object.fromEntries(childRoles.map((childRole) => [childRole, sameCountry.filter((parent) => !excluded.has(parent.id) && isParentRoleValid(childRole, parent.role))])) as Partial<Record<Role, RoleParent[]>>;
  return { validParents, suggestedParentId, childRoles, childParents };
}
