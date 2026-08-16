"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { clearSession, createSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/guard";
import { accountByRoleCode, createInitialMaster } from "@/lib/db/repositories/accounts";
import { createTemporaryLiveRestriction, transferCoins, transitionWithdrawal } from "@/lib/db/repositories/operations";
import { db } from "@/lib/db/pool";

const loginInput = z.object({ roleCode: z.string().trim().min(3).max(32), password: z.string().min(1).max(200) });

export async function signIn(formData: FormData) {
  const parsed = loginInput.safeParse({ roleCode: formData.get("roleCode"), password: formData.get("password") });
  if (!parsed.success) redirect("/login?error=Enter+your+role+code+and+password.");

  let account = await accountByRoleCode(parsed.data.roleCode);
  const initialCode = process.env.INITIAL_MASTER_CODE?.trim().toUpperCase();
  const initialPassword = process.env.INITIAL_MASTER_PASSWORD;
  const initialName = process.env.INITIAL_MASTER_NAME?.trim();
  if (!account && initialCode && initialPassword && initialPassword.length >= 12 && initialName && parsed.data.roleCode.toUpperCase() === initialCode && parsed.data.password === initialPassword) {
    await createInitialMaster({ roleCode: initialCode, fullName: initialName, password: initialPassword });
    account = await accountByRoleCode(initialCode);
  }
  if (!account || account.status !== "ACTIVE" || !(await bcrypt.compare(parsed.data.password, account.passwordHash))) {
    redirect("/login?error=Invalid+role+code+or+password.");
  }
  await db().execute("UPDATE platform_accounts SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [account.id]);
  const requestHeaders = await headers();
  await db().execute(
    `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, ip_address, user_agent)
     VALUES (UUID(), ?, ?, 'auth.login', 'authentication', 'platform_account', ?, ?, ?)`,
    [account.id, account.role, account.id, requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, requestHeaders.get("user-agent")?.slice(0, 500) ?? null],
  );
  await createSession({ id: account.id, role: account.role, roleCode: account.roleCode, fullName: account.fullName });
  redirect("/dashboard");
}

export async function signOut() {
  await clearSession();
  redirect("/login");
}

export async function submitCoinTransfer(formData: FormData) {
  const scope = await requirePermission("coins.transfer");
  const recipientId = z.string().uuid().safeParse(formData.get("recipientId"));
  const amount = z.coerce.number().int().positive().safeParse(formData.get("amount"));
  const reason = z.string().trim().min(5).max(500).safeParse(formData.get("reason"));
  if (!recipientId.success || !amount.success || !reason.success) redirect("/dashboard/wallet?error=Check+the+recipient%2C+amount%2C+and+reason.");
  let result: Awaited<ReturnType<typeof transferCoins>>;
  try { result = await transferCoins({ scope, recipientId: recipientId.data, amount: amount.data, reason: reason.data }); } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer could not be completed.";
    redirect(`/dashboard/wallet?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/wallet");
  revalidatePath("/dashboard/transactions");
  redirect(`/dashboard/wallet?success=${encodeURIComponent(`${result.transferCode}: ${amount.data.toLocaleString()} coins sent to ${result.recipientName}`)}`);
}

export async function submitWithdrawalTransition(formData: FormData) {
  const scope = await requirePermission("withdrawals.review");
  const withdrawalId = z.string().uuid().safeParse(formData.get("withdrawalId"));
  const nextStatus = z.enum(["UNDER_REVIEW", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED"]).safeParse(formData.get("nextStatus"));
  const reason = z.string().trim().min(2).max(500).safeParse(formData.get("reason"));
  if (!withdrawalId.success || !nextStatus.success || !reason.success) redirect("/dashboard/withdrawals?error=Add+a+valid+status+and+reason.");
  try { await transitionWithdrawal({ scope, withdrawalId: withdrawalId.data, nextStatus: nextStatus.data, reason: reason.data }); } catch (error) {
    redirect(`/dashboard/withdrawals?error=${encodeURIComponent(error instanceof Error ? error.message : "Status update failed.")}`);
  }
  revalidatePath("/dashboard/withdrawals");
  revalidatePath("/dashboard");
  redirect("/dashboard/withdrawals?success=Withdrawal+status+updated.");
}

export async function submitTemporaryRestriction(formData: FormData) {
  const scope = await requirePermission("rooms.restrict");
  if (scope.account.role !== "MONITORING_CS" && !can(scope.account.role, "rooms.restrict")) redirect("/dashboard/rooms?error=Not+permitted.");
  const applicationUserId = z.string().uuid().safeParse(formData.get("applicationUserId"));
  const reason = z.string().trim().min(5).max(500).safeParse(formData.get("reason"));
  if (!applicationUserId.success || !reason.success) redirect("/dashboard/rooms?error=Choose+a+user+and+provide+a+reason.");
  let result: Awaited<ReturnType<typeof createTemporaryLiveRestriction>>;
  try { result = await createTemporaryLiveRestriction({ scope, applicationUserId: applicationUserId.data, reason: reason.data }); } catch (error) {
    redirect(`/dashboard/rooms?error=${encodeURIComponent(error instanceof Error ? error.message : "Restriction failed.")}`);
  }
  revalidatePath("/dashboard/rooms");
  redirect(`/dashboard/rooms?success=${encodeURIComponent(`${result.userName} has a two-hour live restriction.`)}`);
}
