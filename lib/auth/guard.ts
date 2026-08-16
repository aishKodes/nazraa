import "server-only";
import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";

export async function requireSession() {
  const account = await getSession();
  if (!account) redirect("/login");
  return account;
}

export async function requirePermission(permission: Permission) {
  const account = await requireSession();
  if (!can(account.role, permission)) redirect("/dashboard?error=forbidden");
  return scopeFor(account);
}
