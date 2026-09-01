"use server";

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, createSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/guard";
import { accountByManagementId, createInitialMaster } from "@/lib/db/repositories/accounts";
import { blockUserDevice, unblockUserDevice } from "@/lib/db/repositories/monitoring";
import { adjustPlatformCoinInventory, allocatePlatformCoins, createTemporaryLiveRestriction, permanentlyBanUser, transferCoins, transitionWithdrawal } from "@/lib/db/repositories/operations";
import { withTransaction } from "@/lib/db/transaction";

const loginInput = z.object({ managementId: z.string().trim().regex(/^\d{6}$/), password: z.string().min(1).max(200) });

export async function signIn(formData: FormData) {
  const parsed = loginInput.safeParse({ managementId: formData.get("managementId"), password: formData.get("password") });
  if (!parsed.success) redirect("/login?error=Enter+your+six-digit+management+ID+and+password.");

  let account: Awaited<ReturnType<typeof accountByManagementId>>;
  try {
    account = await accountByManagementId(parsed.data.managementId);
  } catch {
    redirect("/login?error=Nazraa+Control+is+reconnecting+to+the+database.+Please+try+signing+in+again.");
  }
  const initialPublicId = process.env.INITIAL_MASTER_PUBLIC_ID?.trim();
  const initialPassword = process.env.INITIAL_MASTER_PASSWORD;
  const initialName = process.env.INITIAL_MASTER_NAME?.trim() || "Nazraa Master";
  if (!account && initialPublicId && parsed.data.managementId === initialPublicId && !initialPassword) {
    redirect("/login?error=First-time+login+is+not+configured.+Add+INITIAL_MASTER_PASSWORD+in+Vercel+and+redeploy.");
  }
  if (!account && initialPublicId && initialPassword && parsed.data.managementId === initialPublicId && parsed.data.password === initialPassword) {
    await createInitialMaster({ publicId: Number(initialPublicId), fullName: initialName, password: initialPassword });
    account = await accountByManagementId(initialPublicId);
  }
  if (!account || !(await bcrypt.compare(parsed.data.password, account.passwordHash))) {
    redirect("/login?error=Invalid+management+ID+or+password.");
  }
  if (account.status === "SUSPENDED") redirect("/login?error=This+account+is+suspended.+Contact+your+manager+to+restore+access.");
  if (account.status !== "ACTIVE") redirect("/login?error=This+account+is+disabled.+Contact+the+platform+Master.");
  const requestHeaders = await headers();
  const loginAuditId = randomUUID();
  try {
    await withTransaction(async (connection) => {
      await connection.execute("UPDATE platform_accounts SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [account.id]);
      await connection.execute(
        `INSERT IGNORE INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, ip_address, user_agent)
         VALUES (?, ?, ?, 'auth.login', 'authentication', 'platform_account', ?, ?, ?)`,
        [loginAuditId, account.id, account.role, account.id, requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, requestHeaders.get("user-agent")?.slice(0, 500) ?? null],
      );
    });
  } catch {
    redirect("/login?error=Nazraa+Control+could+not+finish+the+secure+login.+Please+try+once+more.");
  }
  await createSession({ id: account.id, publicId: account.publicId, role: account.role, fullName: account.fullName });
  redirect("/dashboard");
}

export async function signOut() {
  await clearSession();
  redirect("/login");
}

export async function submitCoinTransfer(formData: FormData) {
  const scope = await requirePermission("coins.transfer");
  const recipientId = z.string().uuid().safeParse(formData.get("recipientId"));
  const idempotencyKey = z.string().uuid().safeParse(formData.get("idempotencyKey"));
  const amount = z.coerce.number().int().positive().safeParse(formData.get("amount"));
  const reason = z.string().trim().min(5).max(500).safeParse(formData.get("reason"));
  const confirmed = formData.get("confirmed") === "yes";
  if (!recipientId.success || !idempotencyKey.success || !amount.success || !reason.success || !confirmed) redirect("/dashboard/wallet?error=Check+the+recipient%2C+amount%2C+reason%2C+and+confirmation.");
  let result: Awaited<ReturnType<typeof transferCoins>>;
  try { result = await transferCoins({ scope, recipientId: recipientId.data, amount: amount.data, reason: reason.data, idempotencyKey: idempotencyKey.data }); } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
    const message = duplicate ? "This transfer was already submitted. No second transfer was made." : error instanceof Error ? error.message : "Transfer could not be completed.";
    redirect(`/dashboard/wallet?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/wallet");
  revalidatePath("/dashboard/transactions");
  redirect(`/dashboard/wallet?success=${encodeURIComponent(`${result.transferCode}: ${amount.data.toLocaleString()} coins sent to ${result.recipientName}`)}`);
}

export async function submitCoinInventoryAdjustment(formData: FormData) {
  const scope = await requirePermission("coins.mint");
  const parsed = z.object({
    accountId: z.string().uuid(), direction: z.enum(["ADD", "REMOVE"]), amount: z.coerce.number().int().positive(),
    reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid(), confirmed: z.literal("yes"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/wallet?error=Choose+an+account%2C+amount%2C+direction%2C+reason%2C+and+confirm.");
  let result: Awaited<ReturnType<typeof adjustPlatformCoinInventory>>;
  try {
    result = await adjustPlatformCoinInventory({ scope, ...parsed.data });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
    redirect(`/dashboard/wallet?error=${encodeURIComponent(duplicate ? "This allocation was already submitted. No second change was made." : error instanceof Error ? error.message : "Inventory could not be updated.")}`);
  }
  revalidatePath("/dashboard"); revalidatePath("/dashboard/wallet"); revalidatePath("/dashboard/transactions");
  redirect(`/dashboard/wallet?success=${encodeURIComponent(`${result.transactionCode}: inventory for ${result.accountName} is now ${result.after.toLocaleString()} coins`)}`);
}

export async function submitPlatformCoinAllocation(formData: FormData) {
  const scope = await requirePermission("coins.allocate");
  const parsed = z.object({
    accountId: z.string().uuid(), amount: z.coerce.number().int().positive(),
    reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid(), confirmed: z.literal("yes"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/wallet?error=Choose+a+downstream+account%2C+amount%2C+reason%2C+and+confirm.");
  let result: Awaited<ReturnType<typeof allocatePlatformCoins>>;
  try {
    result = await allocatePlatformCoins({ scope, ...parsed.data });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
    redirect(`/dashboard/wallet?error=${encodeURIComponent(duplicate ? "This allocation was already submitted. No second change was made." : error instanceof Error ? error.message : "Allocation failed.")}`);
  }
  revalidatePath("/dashboard"); revalidatePath("/dashboard/wallet"); revalidatePath("/dashboard/transactions");
  redirect(`/dashboard/wallet?success=${encodeURIComponent(`${result.transactionCode}: ${result.accountName} now has ${result.receiverAfter.toLocaleString()} coins`)}`);
}

export async function submitWithdrawalTransition(formData: FormData) {
  const scope = await requirePermission("withdrawals.review");
  const withdrawalId = z.string().uuid().safeParse(formData.get("withdrawalId"));
  const nextStatus = z.enum(["UNDER_REVIEW", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED"]).safeParse(formData.get("nextStatus"));
  const reason = z.string().trim().min(2).max(500).safeParse(formData.get("reason"));
  const providerReference = z.string().trim().max(120).optional().safeParse(formData.get("providerReference")?.toString() || undefined);
  const confirmed = formData.get("confirmed") === "yes";
  if (!withdrawalId.success || !nextStatus.success || !reason.success || !providerReference.success || !confirmed) redirect("/dashboard/withdrawals?error=Add+a+valid+status%2C+reason%2C+and+confirm+the+decision.");
  try { await transitionWithdrawal({ scope, withdrawalId: withdrawalId.data, nextStatus: nextStatus.data, reason: reason.data, providerReference: providerReference.data }); } catch (error) {
    redirect(`/dashboard/withdrawals?error=${encodeURIComponent(error instanceof Error ? error.message : "Status update failed.")}`);
  }
  revalidatePath("/dashboard/withdrawals");
  revalidatePath("/dashboard");
  redirect("/dashboard/withdrawals?success=Withdrawal+status+updated.");
}

export async function submitTemporaryRestriction(formData: FormData) {
  const scope = await requirePermission("rooms.restrict");
  const applicationUserId = z.string().uuid().safeParse(formData.get("applicationUserId"));
  const reason = z.string().trim().min(5).max(500).safeParse(formData.get("reason"));
  const durationMinutes = z.coerce.number().pipe(z.union([z.literal(30), z.literal(60), z.literal(120)])).safeParse(formData.get("durationMinutes"));
  const confirmed = formData.get("confirmed") === "yes";
  const returnTo = z.enum(["rooms", "monitoring"]).catch("rooms").parse(formData.get("returnTo"));
  const path = `/dashboard/${returnTo}`;
  if (!applicationUserId.success || !reason.success || !durationMinutes.success || !confirmed) redirect(`${path}?error=Choose+a+duration%2C+confirm%2C+and+provide+a+reason.`);
  let result: Awaited<ReturnType<typeof createTemporaryLiveRestriction>>;
  try { result = await createTemporaryLiveRestriction({ scope, applicationUserId: applicationUserId.data, reason: reason.data, durationMinutes: durationMinutes.data }); } catch (error) {
    redirect(`${path}?error=${encodeURIComponent(error instanceof Error ? error.message : "Restriction failed.")}`);
  }
  revalidatePath("/dashboard/rooms");
  revalidatePath("/dashboard/monitoring");
  redirect(`${path}?success=${encodeURIComponent(`${result.userName} has a ${durationMinutes.data}-minute Live restriction.`)}`);
}

export async function submitPermanentUserBan(formData: FormData) {
  const scope = await requirePermission("users.permanent");
  const parsed = z.object({
    applicationUserId: z.string().uuid(), reason: z.string().trim().min(5).max(500), confirmation: z.literal("BAN"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/monitoring?error=Type+BAN+and+provide+a+clear+reason.");
  try { await permanentlyBanUser({ scope, applicationUserId: parsed.data.applicationUserId, reason: parsed.data.reason, confirmed: true }); } catch (error) {
    redirect(`/dashboard/monitoring?error=${encodeURIComponent(error instanceof Error ? error.message : "Permanent ban failed.")}`);
  }
  revalidatePath("/dashboard/monitoring"); revalidatePath("/dashboard/users"); revalidatePath("/dashboard/rooms");
  redirect("/dashboard/monitoring?success=User+permanently+banned+and+all+sessions+were+revoked.");
}

export async function submitDeviceBlock(formData: FormData) {
  const scope = await requirePermission("devices.manage");
  const parsed = z.object({ sessionId: z.string().uuid(), reason: z.string().trim().min(5).max(500), confirmed: z.literal("yes") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/monitoring?error=Choose+a+device+and+provide+a+clear+reason.");
  try { await blockUserDevice({ scope, sessionId: parsed.data.sessionId, reason: parsed.data.reason }); } catch (error) {
    redirect(`/dashboard/monitoring?error=${encodeURIComponent(error instanceof Error ? error.message : "Device block failed.")}`);
  }
  revalidatePath("/dashboard/monitoring");
  redirect("/dashboard/monitoring?success=Device+blocked+and+its+session+was+revoked.");
}

export async function submitDeviceUnblock(formData: FormData) {
  const scope = await requirePermission("devices.manage");
  const parsed = z.object({ blockId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/monitoring?error=Choose+a+blocked+device+and+provide+a+clear+reason.");
  try { await unblockUserDevice({ scope, ...parsed.data }); } catch (error) {
    redirect(`/dashboard/monitoring?error=${encodeURIComponent(error instanceof Error ? error.message : "Device unblock failed.")}`);
  }
  revalidatePath("/dashboard/monitoring");
  redirect("/dashboard/monitoring?success=Device+unblocked.+The+user+can+sign+in+again.");
}
