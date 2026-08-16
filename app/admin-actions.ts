"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guard";
import { createPlatformAccount, resetAccountPassword, updateAccountStatus, updateDocumentVerification } from "@/lib/db/repositories/administration";
import { createHostApplication, reviewHostApplication, updateHostStatus, uploadHostDocument } from "@/lib/db/repositories/hosts";
import { createBanner, createGift, createNotification, saveEconomySettings, saveMobileAppSettings, setBannerActive, setGiftActive, updateSupportTicket } from "@/lib/db/repositories/catalog";
import { updateRiskFlag, updateRoomStatus } from "@/lib/db/repositories/operations";
import { preparePrivateDocument } from "@/lib/security/documents";
import { roles } from "@/types/platform";

function destination(path: string, kind: "error" | "success", message: string) {
  return `${path}?${kind}=${encodeURIComponent(message)}`;
}

export async function submitCreateAccount(formData: FormData) {
  const scope = await requirePermission("accounts.create");
  const parsed = z.object({
    role: z.enum(roles), fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().optional().or(z.literal("")),
    mobile: z.string().trim().max(24).optional(), countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    applicationUserId: z.string().trim().max(80).optional(), password: z.string().min(8).max(200), requestedParentId: z.string().uuid().optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(["role", "fullName", "email", "mobile", "countryCode", "applicationUserId", "password", "requestedParentId"].map((key) => [key, formData.get(key)])));
  if (!parsed.success) redirect(destination("/dashboard/accounts", "error", "Check the required account details and use a password of at least 8 characters."));
  let result: Awaited<ReturnType<typeof createPlatformAccount>>;
  try {
    const fileInputs = [["idFront", "GOVERNMENT_ID_FRONT"], ["idBack", "GOVERNMENT_ID_BACK"], ["profilePhoto", "PROFILE_PHOTO"]] as const;
    const documents = [];
    for (const [field, type] of fileInputs) {
      const value = formData.get(field);
      if (value instanceof File && value.size) {
        const document = await preparePrivateDocument(value, randomUUID(), type);
        if (document) documents.push(document);
      }
    }
    result = await createPlatformAccount({ scope, ...parsed.data, documents });
  } catch (error) {
    redirect(destination("/dashboard/accounts", "error", error instanceof Error ? error.message : "Account could not be created."));
  }
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/hierarchy");
  redirect(destination("/dashboard/accounts", "success", `${result.roleCode} created. Share the role code and password securely.`));
}

export async function submitAccountStatus(formData: FormData) {
  const scope = await requirePermission("accounts.manage");
  const parsed = z.object({ accountId: z.string().uuid(), nextStatus: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/accounts", "error", "Choose a status and provide a clear reason."));
  try { await updateAccountStatus({ scope, ...parsed.data }); } catch (error) {
    redirect(destination("/dashboard/accounts", "error", error instanceof Error ? error.message : "Account status could not be updated."));
  }
  revalidatePath("/dashboard/accounts");
  redirect(destination("/dashboard/accounts", "success", "Account status updated."));
}

export async function submitPasswordReset(formData: FormData) {
  const scope = await requirePermission("accounts.manage");
  const parsed = z.object({ accountId: z.string().uuid(), password: z.string().min(8).max(200), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/accounts", "error", "Use a password of at least 8 characters and provide a reason."));
  try { await resetAccountPassword({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/accounts", "error", error instanceof Error ? error.message : "Password reset failed.")); }
  redirect(destination("/dashboard/accounts", "success", "Temporary password saved. Share it securely."));
}

export async function submitCreateHostApplication(formData: FormData) {
  const scope = await requirePermission("hosts.review");
  const parsed = z.object({ applicationUserId: z.string().uuid(), legalName: z.string().trim().min(2).max(120), countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()), agencyAccountId: z.string().uuid().optional().or(z.literal("")), governmentIdType: z.string().trim().min(2).max(80), governmentIdLast4: z.string().trim().min(4).max(8) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/hosts", "error", "Complete the host application details."));
  try {
    const documents = [];
    for (const [field, type] of [["idFront", "GOVERNMENT_ID_FRONT"], ["idBack", "GOVERNMENT_ID_BACK"], ["profilePhoto", "PROFILE_PHOTO"]] as const) {
      const value = formData.get(field);
      if (value instanceof File && value.size) { const document = await preparePrivateDocument(value, randomUUID(), type); if (document) documents.push(document); }
    }
    if (!documents.some((document) => document.documentType === "GOVERNMENT_ID_FRONT")) throw new Error("Government ID front is required.");
    await createHostApplication({ scope, ...parsed.data, documents });
  } catch (error) {
    redirect(destination("/dashboard/hosts", "error", error instanceof Error ? error.message : "Host application could not be created."));
  }
  revalidatePath("/dashboard/hosts");
  redirect(destination("/dashboard/hosts", "success", "Host application added to the review queue."));
}

export async function submitHostDocument(formData: FormData) {
  const scope = await requirePermission("documents.upload");
  const parsed = z.object({ hostId: z.string().uuid(), documentType: z.string().trim().min(2).max(80) }).safeParse(Object.fromEntries(formData));
  const file = formData.get("document");
  if (!parsed.success || !(file instanceof File) || !file.size) redirect(destination("/dashboard/hosts", "error", "Choose a document to upload."));
  try {
    const document = await preparePrivateDocument(file, randomUUID(), parsed.data.documentType);
    if (!document) throw new Error("Choose a document to upload.");
    await uploadHostDocument({ scope, hostId: parsed.data.hostId, document });
  } catch (error) {
    redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "error", error instanceof Error ? error.message : "Document could not be uploaded."));
  }
  revalidatePath(`/dashboard/hosts/${parsed.data.hostId}`);
  redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "success", "Document uploaded securely."));
}

export async function submitHostReview(formData: FormData) {
  const scope = await requirePermission("hosts.review");
  const parsed = z.object({ hostId: z.string().uuid(), decision: z.enum(["APPROVED", "REJECTED"]), agencyAccountId: z.string().uuid().optional().or(z.literal("")), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/hosts", "error", "Choose a decision, agency, and clear reason."));
  try { await reviewHostApplication({ scope, ...parsed.data }); } catch (error) {
    redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "error", error instanceof Error ? error.message : "Host review could not be saved."));
  }
  revalidatePath("/dashboard/hosts"); revalidatePath(`/dashboard/hosts/${parsed.data.hostId}`); revalidatePath("/dashboard/users");
  redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "success", `Host application ${parsed.data.decision.toLowerCase()}.`));
}

export async function submitHostStatus(formData: FormData) {
  const scope = await requirePermission("hosts.review");
  const parsed = z.object({ hostId: z.string().uuid(), status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/hosts", "error", "Choose a host status and provide a clear reason."));
  try { await updateHostStatus({ scope, ...parsed.data }); } catch (error) { redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "error", error instanceof Error ? error.message : "Host status could not be updated.")); }
  revalidatePath("/dashboard/hosts"); revalidatePath(`/dashboard/hosts/${parsed.data.hostId}`);
  redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "success", "Host status updated."));
}

export async function submitCreateGift(formData: FormData) {
  const scope = await requirePermission("gifts.manage");
  const parsed = z.object({ key: z.string().trim().regex(/^[a-z0-9_]+$/).max(80), name: z.string().trim().min(2).max(100), category: z.string().trim().min(2).max(60), coinPrice: z.coerce.number().int().positive(), visualUrl: z.string().trim().url().optional().or(z.literal("")), animationKey: z.string().trim().max(120).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/gifts", "error", "Check the gift key, name, category, price, and optional URL."));
  try { await createGift({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/gifts", "error", error instanceof Error ? error.message : "Gift could not be created.")); }
  revalidatePath("/dashboard/gifts"); redirect(destination("/dashboard/gifts", "success", "Gift created."));
}

export async function submitGiftStatus(formData: FormData) {
  const scope = await requirePermission("gifts.manage"); const id = z.string().uuid().parse(formData.get("id")); const active = formData.get("active") === "true";
  await setGiftActive({ scope, id, active }); revalidatePath("/dashboard/gifts"); redirect(destination("/dashboard/gifts", "success", active ? "Gift enabled." : "Gift disabled."));
}

export async function submitCreateBanner(formData: FormData) {
  const scope = await requirePermission("banners.manage");
  const parsed = z.object({ placement: z.string().trim().min(2).max(60), title: z.string().trim().min(2).max(120), subtitle: z.string().trim().max(240).optional(), imageUrl: z.string().trim().url(), actionType: z.string().trim().max(40), actionTarget: z.string().trim().max(500).optional(), startsAt: z.string().optional(), endsAt: z.string().optional(), priority: z.coerce.number().int().min(0).max(999) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/banners", "error", "Check the banner title, HTTPS image URL, placement, and schedule."));
  if (parsed.data.startsAt && parsed.data.endsAt && new Date(parsed.data.endsAt) <= new Date(parsed.data.startsAt)) redirect(destination("/dashboard/banners", "error", "Banner end time must be after its start time."));
  try { await createBanner({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/banners", "error", error instanceof Error ? error.message : "Banner could not be created.")); }
  revalidatePath("/dashboard/banners"); redirect(destination("/dashboard/banners", "success", "Banner created."));
}

export async function submitBannerStatus(formData: FormData) {
  const scope = await requirePermission("banners.manage"); const id = z.string().uuid().parse(formData.get("id")); const active = formData.get("active") === "true";
  await setBannerActive({ scope, id, active }); revalidatePath("/dashboard/banners"); redirect(destination("/dashboard/banners", "success", active ? "Banner enabled." : "Banner disabled."));
}

export async function submitNotification(formData: FormData) {
  const scope = await requirePermission("notifications.manage");
  const parsed = z.object({ title: z.string().trim().min(2).max(120), message: z.string().trim().min(3).max(500), audienceRole: z.string().trim().max(32).optional(), actionTarget: z.string().trim().max(500).optional(), scheduledAt: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/notifications", "error", "Add a title and message."));
  try { await createNotification({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/notifications", "error", error instanceof Error ? error.message : "Notification could not be created.")); }
  revalidatePath("/dashboard/notifications"); redirect(destination("/dashboard/notifications", "success", parsed.data.scheduledAt ? "Notification scheduled." : "Notification published."));
}

export async function submitSupportUpdate(formData: FormData) {
  const scope = await requirePermission("support.manage");
  const parsed = z.object({ ticketId: z.string().uuid(), status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"]), message: z.string().trim().min(2).max(2000), internalNote: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/support", "error", "Add a reply or note and choose the ticket status."));
  try { await updateSupportTicket({ scope, ...parsed.data, internalNote: parsed.data.internalNote === "true" }); } catch (error) { redirect(destination("/dashboard/support", "error", error instanceof Error ? error.message : "Ticket could not be updated.")); }
  revalidatePath("/dashboard/support"); redirect(destination("/dashboard/support", "success", "Ticket updated."));
}

export async function submitEconomySettings(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({ rate: z.coerce.number().positive(), minimum: z.coerce.number().int().positive(), currency: z.string().trim().length(3).transform((value) => value.toUpperCase()) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Enter a positive rate, minimum, and three-letter currency."));
  await saveEconomySettings({ scope, ...parsed.data }); revalidatePath("/dashboard/settings"); redirect(destination("/dashboard/settings", "success", "Economy settings saved."));
}

export async function submitMobileAppSettings(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const optionalUrl = z.string().trim().url().optional().or(z.literal(""));
  const parsed = z.object({
    minimumVersion: z.string().trim().min(1).max(30), latestVersion: z.string().trim().min(1).max(30), maintenanceMessage: z.string().trim().max(500).optional(),
    updateUrl: optionalUrl, supportUrl: optionalUrl, withdrawalUrl: optionalUrl,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check the app versions and optional HTTPS URLs."));
  await saveMobileAppSettings({ scope, ...parsed.data, maintenance: formData.get("maintenance") === "true" });
  revalidatePath("/dashboard/settings"); redirect(destination("/dashboard/settings", "success", "Mobile app configuration saved."));
}

export async function submitRiskStatus(formData: FormData) {
  const scope = await requirePermission("risk.manage"); const parsed = z.object({ flagId: z.string().uuid(), status: z.enum(["REVIEWING", "RESOLVED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/risk", "error", "Choose a status and provide a reason."));
  await updateRiskFlag({ scope, ...parsed.data }); revalidatePath("/dashboard/risk"); redirect(destination("/dashboard/risk", "success", "Risk flag updated."));
}

export async function submitRoomStatus(formData: FormData) {
  const scope = await requirePermission("rooms.manage"); const parsed = z.object({ roomId: z.string().uuid(), status: z.enum(["ACTIVE", "LOCKED", "ENDED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/rooms", "error", "Choose a room action and provide a reason."));
  try { await updateRoomStatus({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/rooms", "error", error instanceof Error ? error.message : "Room action failed.")); }
  revalidatePath("/dashboard/rooms"); redirect(destination("/dashboard/rooms", "success", `Room ${parsed.data.status.toLowerCase()}.`));
}

export async function submitDocumentReview(formData: FormData) {
  const scope = await requirePermission("documents.manage");
  const parsed = z.object({ documentId: z.string().uuid(), ownerId: z.string().uuid(), ownerType: z.enum(["ACCOUNT", "HOST"]), status: z.enum(["VERIFIED", "REJECTED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard", "error", "Choose a document decision and provide a reason."));
  const path = parsed.data.ownerType === "ACCOUNT" ? `/dashboard/accounts/${parsed.data.ownerId}` : `/dashboard/hosts/${parsed.data.ownerId}`;
  try { await updateDocumentVerification({ scope, documentId: parsed.data.documentId, status: parsed.data.status, reason: parsed.data.reason }); } catch (error) { redirect(destination(path, "error", error instanceof Error ? error.message : "Document review failed.")); }
  revalidatePath(path); redirect(destination(path, "success", "Document verification updated."));
}
