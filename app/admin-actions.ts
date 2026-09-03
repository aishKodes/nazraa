"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guard";
import {
  changePlatformAccountRole,
  createPlatformAccount,
  permanentlyRemovePlatformAccount,
  reassignPlatformAccount,
  resetAccountPassword,
  updateAccountStatus,
  updateDocumentVerification,
  updatePlatformAccount,
} from "@/lib/db/repositories/administration";
import { createHostApplication, reviewHostApplication, updateHostGender, updateHostStatus, uploadHostDocument } from "@/lib/db/repositories/hosts";
import { createBanner, createGift, createNotification, saveEconomySettings, saveGameSettings, saveMobileAppSettings, saveMobileSocialSettings, saveRoomFeatureSettings, setBannerActive, setGiftActive, updateGift, updateSupportTicket } from "@/lib/db/repositories/catalog";
import { restoreLiveAccess, updateRiskFlag, updateRoomStatus } from "@/lib/db/repositories/operations";
import { createCoinPackage, reviewFaceVerification, reviewPayoutMethod, saveCommerceSettings, saveWithdrawalEconomy, setCoinPackageActive, transitionCoinOrder, updateCoinPackage, updateSellerProfile } from "@/lib/db/repositories/mobile-administration";
import { saveDailyRewardRules, saveDiamondConversionRule, saveHostRewardRules, saveRocketSettings, saveVipValidity, setFaceLiveAuthorization } from "@/lib/db/repositories/completion-administration";
import { preparePrivateDocument } from "@/lib/security/documents";
import { preparePublicImage } from "@/lib/security/public-images";
import { reviewAgencyCreation, reviewAgencyJoin } from "@/lib/db/repositories/agency-applications";
import { roles } from "@/types/platform";
import { deleteBanner } from "@/lib/db/repositories/catalog";
import { parseRoleChange } from "@/lib/auth/role-change-validation";
import { roleLabel } from "@/lib/auth/role-hierarchy";
import { isPanelCountry } from "@/lib/countries";
import { configurableGameIds } from "@/lib/games/game-config";

function destination(path: string, kind: "error" | "success", message: string) {
  return `${path}?${kind}=${encodeURIComponent(message)}`;
}

export async function submitCreateAccount(formData: FormData) {
  const scope = await requirePermission("accounts.create");
  const parsed = z.object({
    accountType: z.enum(roles), fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().optional().or(z.literal("")),
    mobile: z.string().trim().max(24).optional(), countryCode: z.string().trim().toUpperCase().refine(isPanelCountry),
    applicationUserId: z.string().trim().max(80).optional(), password: z.string().min(8).max(200), requestedParentId: z.string().uuid().optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(["accountType", "fullName", "email", "mobile", "countryCode", "applicationUserId", "password", "requestedParentId"].map((key) => [key, formData.get(key)])));
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
    const { accountType, ...data } = parsed.data;
    result = await createPlatformAccount({ scope, ...data, role: accountType, documents });
  } catch (error) {
    redirect(destination("/dashboard/accounts", "error", error instanceof Error ? error.message : "Account could not be created."));
  }
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/hierarchy");
  redirect(destination("/dashboard/accounts", "success", `Management ID ${result.publicId} created. Share the six-digit ID and password securely.`));
}

export async function submitHierarchyReassignment(formData: FormData) {
  const scope = await requirePermission("accounts.reassign");
  const parsed = z.object({ accountId: z.string().uuid(), parentAccountId: z.string().uuid(), reason: z.string().trim().min(5).max(500), confirmed: z.literal("yes") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/hierarchy", "error", "Choose a child, parent, enter a clear reason, and confirm."));
  try {
    await reassignPlatformAccount({ scope, ...parsed.data });
  } catch (error) {
    redirect(destination("/dashboard/hierarchy", "error", error instanceof Error ? error.message : "Hierarchy could not be updated."));
  }
  revalidatePath("/dashboard/hierarchy"); revalidatePath("/dashboard/accounts"); revalidatePath("/dashboard/agencies");
  redirect(destination("/dashboard/hierarchy", "success", "Hierarchy assignment updated and audited."));
}

export async function submitAccountEdit(formData: FormData) {
  const scope = await requirePermission("accounts.edit");
  const parsed = z.object({
    accountId: z.string().uuid(),
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().optional().or(z.literal("")),
    mobile: z.string().trim().max(24).optional(),
    countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/accounts", "error", "Check the account details and provide a clear reason."));
  try { await updatePlatformAccount({ scope, ...parsed.data }); } catch (error) {
    redirect(destination(`/dashboard/accounts/${parsed.data.accountId}`, "error", error instanceof Error ? error.message : "Account details could not be updated."));
  }
  revalidatePath("/dashboard/accounts");
  revalidatePath(`/dashboard/accounts/${parsed.data.accountId}`);
  redirect(destination(`/dashboard/accounts/${parsed.data.accountId}`, "success", "Account details updated and audited."));
}

export async function submitAccountRoleChange(_previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const scope = await requirePermission("accounts.roles");
  const parsed = parseRoleChange(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the role change details." };
  let result: Awaited<ReturnType<typeof changePlatformAccountRole>>;
  try {
    result = await changePlatformAccountRole({ scope, ...parsed.data });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Account role could not be changed. Please try again." };
  }
  revalidatePath("/dashboard", "layout");
  const created = result.created.map((account) => `${roleLabel(account.role)} created: management ID ${account.publicId}.`).join(" ");
  redirect(destination(`/dashboard/accounts/${parsed.data.accountId}`, "success", `Role changed to ${roleLabel(parsed.data.role)}. Hierarchy saved and audited. ${created}`.trim()));
}

export async function submitPermanentAccountRemoval(formData: FormData) {
  const scope = await requirePermission("accounts.permanent");
  const parsed = z.object({
    accountId: z.string().uuid(), reason: z.string().trim().min(5).max(500), confirmation: z.literal("REMOVE"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/accounts", "error", "Type REMOVE and provide a clear reason."));
  try { await permanentlyRemovePlatformAccount({ scope, accountId: parsed.data.accountId, reason: parsed.data.reason, confirmed: true }); } catch (error) {
    redirect(destination(`/dashboard/accounts/${parsed.data.accountId}`, "error", error instanceof Error ? error.message : "Account could not be removed."));
  }
  revalidatePath("/dashboard/accounts"); revalidatePath("/dashboard/hierarchy");
  redirect(destination("/dashboard/accounts", "success", "Account permanently disabled and the action was audited."));
}

export async function submitAccountStatus(_previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const scope = await requirePermission("accounts.manage");
  const parsed = z.object({ accountId: z.string().uuid(), expectedStatus: z.enum(["ACTIVE", "SUSPENDED"]), nextStatus: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().min(5, "Enter a reason of at least 5 characters.").max(500), confirmed: z.literal("yes", { errorMap: () => ({ message: "Confirm the status change before saving." }) }) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the status change details." };
  try { await updateAccountStatus({ scope, accountId: parsed.data.accountId, expectedStatus: parsed.data.expectedStatus, nextStatus: parsed.data.nextStatus, reason: parsed.data.reason }); } catch (error) {
    return { error: error instanceof Error ? error.message : "Account status could not be updated." };
  }
  revalidatePath("/dashboard", "layout");
  redirect(destination(`/dashboard/accounts/${parsed.data.accountId}`, "success", parsed.data.nextStatus === "SUSPENDED" ? "Account suspended. Its management ID can no longer sign in." : "Account reactivated. Login access has been restored."));
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
  const parsed = z.object({ hostId: z.string().uuid(), status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]), reason: z.string().trim().min(5).max(500), confirmed: z.literal("yes") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/hosts", "error", "Choose a host status, enter a clear reason and confirm the change."));
  try { await updateHostStatus({ scope, ...parsed.data }); } catch (error) { redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "error", error instanceof Error ? error.message : "Host status could not be updated.")); }
  revalidatePath("/dashboard", "layout");
  redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "success", parsed.data.status === "ACTIVE" ? "Hosting restored. Other verification and moderation requirements still apply." : "Hosting blocked and current rooms ended. New Video, Party and Face Live rooms cannot be created."));
}

export async function submitCreateGift(formData: FormData) {
  const scope = await requirePermission("gifts.manage");
  const parsed = z.object({ key: z.string().trim().regex(/^[a-z0-9_]+$/).max(80), name: z.string().trim().min(2).max(100), category: z.string().trim().min(2).max(60), catalogType: z.enum(["VIRTUAL_GIFT", "ENTRY_FRAME", "PROFILE_EFFECT", "MEDAL", "BADGE"]), artworkMode: z.enum(["EMOJI", "IMAGE"]), emoji: z.string().trim().max(16).optional(), coinPrice: z.coerce.number().int().positive(), animationKey: z.string().trim().max(120).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/gifts", "error", "Check the catalogue key, type, name, category, price, and animation key."));
  try {
    const imageFile = formData.get("image");
    const image = imageFile instanceof File && imageFile.size ? await preparePublicImage(imageFile, 1024 * 1024, "Gift artwork", { maxWidth: 512, maxHeight: 512, animated: true }) : undefined;
    if (parsed.data.artworkMode === "IMAGE" && !image) throw new Error("Choose a gift picture.");
    if (parsed.data.artworkMode === "EMOJI" && !parsed.data.emoji) throw new Error("Choose a gift emoji.");
    await createGift({ scope, ...parsed.data, emoji: parsed.data.artworkMode === "EMOJI" ? parsed.data.emoji : undefined, image: parsed.data.artworkMode === "IMAGE" ? image : undefined });
  } catch (error) { redirect(destination("/dashboard/gifts", "error", error instanceof Error ? error.message : "Gift could not be created.")); }
  revalidatePath("/dashboard/gifts"); redirect(destination("/dashboard/gifts", "success", "Gift created."));
}

export async function submitGiftUpdate(formData: FormData) {
  const scope = await requirePermission("gifts.manage");
  const parsed = z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(100), category: z.string().trim().min(2).max(60), catalogType: z.enum(["VIRTUAL_GIFT", "ENTRY_FRAME", "PROFILE_EFFECT", "MEDAL", "BADGE"]), artworkMode: z.enum(["EMOJI", "IMAGE"]), emoji: z.string().trim().max(16).optional(), coinPrice: z.coerce.number().int().positive(), animationKey: z.string().trim().max(120).optional(), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/gifts", "error", "Check the gift details and change reason."));
  try {
    const imageFile = formData.get("image");
    const image = imageFile instanceof File && imageFile.size ? await preparePublicImage(imageFile, 1024 * 1024, "Gift artwork", { maxWidth: 512, maxHeight: 512, animated: true }) : undefined;
    if (parsed.data.artworkMode === "EMOJI" && !parsed.data.emoji) throw new Error("Choose a gift emoji.");
    await updateGift({ scope, ...parsed.data, image });
  } catch (error) { redirect(destination("/dashboard/gifts", "error", error instanceof Error ? error.message : "Gift could not be updated.")); }
  revalidatePath("/dashboard/gifts");
  redirect(destination("/dashboard/gifts", "success", "Gift details and mobile price updated."));
}

export async function submitGiftStatus(formData: FormData) {
  const scope = await requirePermission("gifts.manage"); const id = z.string().uuid().parse(formData.get("id")); const active = formData.get("active") === "true";
  await setGiftActive({ scope, id, active }); revalidatePath("/dashboard/gifts"); redirect(destination("/dashboard/gifts", "success", active ? "Gift enabled." : "Gift disabled."));
}

export async function submitCreateBanner(formData: FormData) {
  const scope = await requirePermission("banners.manage");
  const parsed = z.object({ placement: z.enum(["HOME", "ROOM", "WALLET", "PROFILE"]), actionType: z.enum(["NONE", "LIVE", "PARTY", "PROFILE", "AGENCY", "WALLET", "DAILY_REWARD", "RANKING"]), actionTarget: z.string().trim().max(80).optional(), startsAt: z.string().optional(), endsAt: z.string().optional(), priority: z.coerce.number().int().min(0).max(999) }).safeParse(Object.fromEntries(formData));
  const imageFile = formData.get("image");
  if (!parsed.success || !(imageFile instanceof File) || !imageFile.size) redirect(destination("/dashboard/banners", "error", "Check the banner image, internal action, placement, and schedule."));
  if (parsed.data.startsAt && parsed.data.endsAt && new Date(parsed.data.endsAt) <= new Date(parsed.data.startsAt)) redirect(destination("/dashboard/banners", "error", "Banner end time must be after its start time."));
  try {
    const image = await preparePublicImage(imageFile, 2 * 1024 * 1024, "Banner", { maxWidth: 1200, maxHeight: 450 });
    const internalTitle = imageFile.name.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Banner";
    await createBanner({ scope, ...parsed.data, title: internalTitle, enabled: formData.get("enabled") === "true", image });
  } catch (error) { redirect(destination("/dashboard/banners", "error", error instanceof Error ? error.message : "Banner could not be created.")); }
  revalidatePath("/dashboard/banners"); redirect(destination("/dashboard/banners", "success", "Banner created."));
}

export async function submitBannerStatus(formData: FormData) {
  const scope = await requirePermission("banners.manage"); const id = z.string().uuid().parse(formData.get("id")); const active = formData.get("active") === "true";
  await setBannerActive({ scope, id, active }); revalidatePath("/dashboard/banners"); redirect(destination("/dashboard/banners", "success", active ? "Banner enabled." : "Banner disabled."));
}

export async function submitDeleteBanner(formData: FormData) {
  const scope = await requirePermission("banners.manage");
  const parsed = z.object({ id: z.string().uuid(), reason: z.string().trim().min(5).max(500), confirmation: z.literal("DELETE") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/banners", "error", "Enter a reason and type DELETE to confirm."));
  try { await deleteBanner({ scope, id: parsed.data.id, reason: parsed.data.reason, confirmed: true }); } catch (error) {
    redirect(destination("/dashboard/banners", "error", error instanceof Error ? error.message : "Banner could not be deleted."));
  }
  revalidatePath("/dashboard/banners");
  redirect(destination("/dashboard/banners", "success", "Banner deleted. Its artwork and audit history are preserved."));
}

export async function submitAgencyApplicationReview(formData: FormData) {
  const scope = await requirePermission("agencies.review");
  const parsed = z.object({ applicationId: z.string().uuid(), type: z.enum(["JOIN", "CREATE"]), decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/agencies", "error", "Choose a decision and enter a clear review reason."));
  try {
    if (parsed.data.type === "JOIN") await reviewAgencyJoin({ scope, ...parsed.data });
    else await reviewAgencyCreation({ scope, ...parsed.data });
  } catch (error) {
    redirect(destination("/dashboard/agencies", "error", error instanceof Error ? error.message : "Agency application review failed."));
  }
  revalidatePath("/dashboard/agencies"); revalidatePath("/dashboard/accounts"); revalidatePath("/dashboard/users"); revalidatePath("/dashboard/hosts");
  redirect(destination("/dashboard/agencies", "success", `Agency application ${parsed.data.decision.toLowerCase()}.`));
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

export async function submitMobileSocialSettings(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({ privateMessageCoinCost: z.coerce.number().int().min(0).max(100000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Enter a valid private-message coin cost."));
  await saveMobileSocialSettings({ scope, ...parsed.data });
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "Private-message pricing saved."));
}

export async function submitGameSettings(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({
    game: z.enum(configurableGameIds),
    availability: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
    targetWinRate: z.coerce.number().min(0).max(1),
    maximumPayoutMultiplier: z.coerce.number().min(1).max(1000),
    bettingSeconds: z.coerce.number().int().min(0).max(300),
    minimumBet: z.coerce.number().int().min(1).max(50_000_000),
    maximumBet: z.coerce.number().int().min(1).max(50_000_000),
    denominations: z.string().trim().min(1).max(500),
    historyLength: z.coerce.number().int().min(1).max(50),
    bigWinThreshold: z.coerce.number().int().min(1).max(1_000_000_000),
    repeatBet: z.enum(["true", "false"]),
    autoPlay: z.enum(["true", "false"]),
    outcomeWeights: z.string().trim().max(500).optional().or(z.literal("")),
    saladWeight: z.coerce.number().int().min(0).max(1_000_000).default(0),
    pizzaWeight: z.coerce.number().int().min(0).max(1_000_000).default(0),
    poolContributionBps: z.coerce.number().int().min(0).max(10_000).default(0),
    poolMinimumForSpecial: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check the game limits, timing, weights, and change reason."));
  const integers = (value: string) => value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isSafeInteger(item));
  try {
    await saveGameSettings({
      scope,
      ...parsed.data,
      enabled: parsed.data.availability !== "DISABLED",
      maintenance: parsed.data.availability === "MAINTENANCE",
      repeatBet: parsed.data.repeatBet === "true",
      autoPlay: parsed.data.autoPlay === "true",
      denominations: integers(parsed.data.denominations),
      outcomeWeights: parsed.data.outcomeWeights ? integers(parsed.data.outcomeWeights) : undefined,
    });
  } catch (error) {
    redirect(destination("/dashboard/settings", "error", error instanceof Error ? error.message : "Game configuration could not be saved."));
  }
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", `${parsed.data.game} controls saved and audited.`));
}

export async function submitRoomFeatureSettings(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({
    interactionRows: z.string().trim().min(1).max(4000),
    interactionAssetKey: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/).optional().or(z.literal("")),
    pkModes: z.string().trim().min(1).max(200),
    presenceWarningLimit: z.coerce.number().int().min(3).max(30),
    presenceSuspensionLimit: z.coerce.number().int().min(1).max(20),
    facePassivePlaybackMode: z.enum(["rtc_fallback", "live_streaming"]),
    partyPassivePlaybackMode: z.enum(["dynamic_rtc_fallback", "live_streaming"]),
    partyStreamingThreshold: z.coerce.number().int().min(2).max(200),
    streamMixingEnabled: z.enum(["true", "false"]),
    pkCompositeStreamingEnabled: z.enum(["true", "false"]),
    mediaReconnectGraceSeconds: z.coerce.number().int().min(5).max(60),
    passiveBackgroundGraceSeconds: z.coerce.number().int().min(5).max(60),
    maxFaceAudioGuests: z.coerce.number().int().min(1).max(12),
    rtcPassiveFallbackCeiling: z.coerce.number().int().min(1).max(100),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check the room interaction, Rocket, PK, and presence values."));
  const interactionRows = parsed.data.interactionRows.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interactionSchema = z.tuple([
    z.string().regex(/^[a-z0-9_-]{2,40}$/),
    z.string().min(1).max(24),
    z.string().min(1).max(16),
    z.enum(["enabled", "disabled"]),
  ]);
  const interactions = interactionRows.map((line) => interactionSchema.safeParse(line.split("|").map((part) => part.trim())));
  if (interactions.some((item) => !item.success) || new Set(interactions.map((item) => item.success ? item.data[0] : "")).size !== interactions.length) {
    redirect(destination("/dashboard/settings", "error", "Use one unique interaction per line: key | label | emoji | enabled/disabled."));
  }
  const normalizedInteractions = interactions.map((item) => {
    if (!item.success) throw new Error("Invalid interaction row.");
    return { key: item.data[0], label: item.data[1], emoji: item.data[2], enabled: item.data[3] === "enabled" };
  });
  const pkModes = parsed.data.pkModes.split(",").map((item) => item.trim()).filter(Boolean);
  if (!pkModes.length) redirect(destination("/dashboard/settings", "error", "Add at least one PK mode."));
  const interactionAssetFile = formData.get("interactionAsset");
  let interactionAsset;
  try {
    interactionAsset = interactionAssetFile instanceof File && interactionAssetFile.size
      ? await preparePublicImage(interactionAssetFile, 1024 * 1024, "Interaction animation", { maxWidth: 512, maxHeight: 512, animated: true })
      : undefined;
  } catch (error) {
    redirect(destination("/dashboard/settings", "error", error instanceof Error ? error.message : "Interaction artwork could not be processed."));
  }
  if (interactionAsset && !parsed.data.interactionAssetKey) redirect(destination("/dashboard/settings", "error", "Enter the interaction key that should receive the uploaded animation."));
  if (parsed.data.interactionAssetKey && !normalizedInteractions.some((item) => item.key === parsed.data.interactionAssetKey)) redirect(destination("/dashboard/settings", "error", "The animation key must match an interaction row."));
  await saveRoomFeatureSettings({
    scope,
    interactions: normalizedInteractions,
    interactionAssetKey: parsed.data.interactionAssetKey || undefined,
    interactionAsset,
    pkDurations: [2, 5, 10],
    pkModes,
    presenceWarningLimit: parsed.data.presenceWarningLimit,
    presenceSuspensionLimit: parsed.data.presenceSuspensionLimit,
    facePassivePlaybackMode: parsed.data.facePassivePlaybackMode,
    partyPassivePlaybackMode: parsed.data.partyPassivePlaybackMode,
    partyStreamingThreshold: parsed.data.partyStreamingThreshold,
    streamMixingEnabled: parsed.data.streamMixingEnabled === "true",
    pkCompositeStreamingEnabled: parsed.data.pkCompositeStreamingEnabled === "true",
    mediaReconnectGraceSeconds: parsed.data.mediaReconnectGraceSeconds,
    passiveBackgroundGraceSeconds: parsed.data.passiveBackgroundGraceSeconds,
    maxFaceAudioGuests: parsed.data.maxFaceAudioGuests,
    rtcPassiveFallbackCeiling: parsed.data.rtcPassiveFallbackCeiling,
  });
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "Room feature configuration published to the app."));
}

export async function submitRocketSettings(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const tierSchema = z.object({
    target: z.coerce.number().int().positive(), top1: z.coerce.number().int().nonnegative(),
    top2: z.coerce.number().int().nonnegative(), top3: z.coerce.number().int().nonnegative(), room: z.coerce.number().int().nonnegative(),
  });
  const common = z.object({
    rocketEnabled: z.enum(["true", "false"]), energyPerCoin: z.coerce.number().int().min(1).max(100),
    minimumUserLevel: z.coerce.number().int().min(1).max(120), minimumVipTier: z.coerce.number().int().min(0).max(5),
    vipEnergyBonusPercent: z.coerce.number().int().min(0).max(500), reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  const tiers = Array.from({ length: 6 }, (_, index) => {
    const level = index + 1;
    const parsed = tierSchema.safeParse({
      target: formData.get(`rocket${level}Target`), top1: formData.get(`rocket${level}Top1`),
      top2: formData.get(`rocket${level}Top2`), top3: formData.get(`rocket${level}Top3`), room: formData.get(`rocket${level}Room`),
    });
    return parsed.success ? { level, ...parsed.data } : null;
  });
  if (!common.success || tiers.some((tier) => tier == null)) redirect(destination("/dashboard/settings", "error", "Check all six Rocket thresholds, rewards, eligibility values, and reason."));
  const validTiers = tiers.filter((tier): tier is NonNullable<typeof tier> => tier != null);
  if (validTiers.some((tier, index) => index > 0 && tier.target <= validTiers[index - 1].target)) redirect(destination("/dashboard/settings", "error", "Rocket thresholds must increase from LV1 through LV6."));
  await saveRocketSettings({
    scope, enabled: common.data.rocketEnabled === "true", energyPerCoin: common.data.energyPerCoin,
    minimumUserLevel: common.data.minimumUserLevel, minimumVipTier: common.data.minimumVipTier,
    vipEnergyBonusPercent: common.data.vipEnergyBonusPercent, reason: common.data.reason, tiers: validTiers,
  });
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "Rocket thresholds, rewards, and eligibility were saved and audited."));
}

export async function submitVipValidity(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({
    vip1: z.coerce.number().int().min(1).max(3650),
    vip2: z.coerce.number().int().min(1).max(3650),
    vip3: z.coerce.number().int().min(1).max(3650),
    vip4: z.coerce.number().int().min(1).max(3650),
    vip5: z.coerce.number().int().min(1).max(3650),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check all five VIP validity values and the change reason."));
  await saveVipValidity({
    scope,
    validityDays: [parsed.data.vip1, parsed.data.vip2, parsed.data.vip3, parsed.data.vip4, parsed.data.vip5],
    reason: parsed.data.reason,
  });
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "VIP validity was saved and audited."));
}

export async function submitRiskStatus(formData: FormData) {
  const scope = await requirePermission("risk.manage"); const parsed = z.object({ flagId: z.string().uuid(), status: z.enum(["REVIEWING", "RESOLVED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/risk", "error", "Choose a status and provide a reason."));
  await updateRiskFlag({ scope, ...parsed.data }); revalidatePath("/dashboard/risk"); redirect(destination("/dashboard/risk", "success", "Risk flag updated."));
}

export async function submitRoomStatus(formData: FormData) {
  const scope = await requirePermission("rooms.manage"); const parsed = z.object({ roomId: z.string().uuid(), status: z.enum(["ACTIVE", "LOCKED", "ENDED"]), reason: z.string().trim().min(5).max(500), confirmed: z.literal("yes") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/rooms", "error", "Choose a room action and provide a reason."));
  try { await updateRoomStatus({ scope, roomId: parsed.data.roomId, status: parsed.data.status, reason: parsed.data.reason }); } catch (error) { redirect(destination("/dashboard/rooms", "error", error instanceof Error ? error.message : "Room action failed.")); }
  revalidatePath("/dashboard/rooms"); redirect(destination("/dashboard/rooms", "success", `Room ${parsed.data.status.toLowerCase()}.`));
}

export async function submitRestoreLiveAccess(formData: FormData) {
  const scope = await requirePermission("rooms.manage");
  const parsed = z.object({
    restrictionId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/rooms", "error", "Provide a valid Live suspension and review reason."));
  let result: Awaited<ReturnType<typeof restoreLiveAccess>>;
  try {
    result = await restoreLiveAccess({ scope, ...parsed.data });
  } catch (error) {
    redirect(destination("/dashboard/rooms", "error", error instanceof Error ? error.message : "Live access could not be restored."));
  }
  revalidatePath("/dashboard/rooms");
  redirect(destination("/dashboard/rooms", "success", `${result.userName}'s Live access was restored.`));
}

export async function submitDocumentReview(formData: FormData) {
  const scope = await requirePermission("documents.manage");
  const parsed = z.object({ documentId: z.string().uuid(), ownerId: z.string().uuid(), ownerType: z.enum(["ACCOUNT", "HOST"]), status: z.enum(["VERIFIED", "REJECTED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard", "error", "Choose a document decision and provide a reason."));
  const path = parsed.data.ownerType === "ACCOUNT" ? `/dashboard/accounts/${parsed.data.ownerId}` : `/dashboard/hosts/${parsed.data.ownerId}`;
  try { await updateDocumentVerification({ scope, documentId: parsed.data.documentId, status: parsed.data.status, reason: parsed.data.reason }); } catch (error) { redirect(destination(path, "error", error instanceof Error ? error.message : "Document review failed.")); }
  revalidatePath(path); redirect(destination(path, "success", "Document verification updated."));
}

export async function submitCreateCoinPackage(formData: FormData) {
  const scope = await requirePermission("coin_packages.manage");
  const parsed = z.object({ name: z.string().trim().min(2).max(100), badge: z.string().trim().max(40).optional(), coins: z.coerce.number().int().positive(), price: z.coerce.number().nonnegative().optional(), currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional().or(z.literal("")), sortOrder: z.coerce.number().int().min(0).max(999) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/commerce", "error", "Check the package name, coins, price, currency, and order."));
  try { await createCoinPackage({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/commerce", "error", error instanceof Error ? error.message : "Package could not be created.")); }
  revalidatePath("/dashboard/commerce"); redirect(destination("/dashboard/commerce", "success", "Coin package created."));
}

export async function submitCoinPackageUpdate(formData: FormData) {
  const scope = await requirePermission("coin_packages.manage");
  const parsed = z.object({ packageId: z.string().uuid(), name: z.string().trim().min(2).max(100), badge: z.string().trim().max(40).optional(), coins: z.coerce.number().int().positive(), price: z.coerce.number().nonnegative().optional(), currency: z.string().trim().length(3).transform((value) => value.toUpperCase()), sortOrder: z.coerce.number().int().min(0).max(999), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/commerce", "error", "Check the package details and change reason."));
  try { await updateCoinPackage({ scope, ...parsed.data }); }
  catch (error) { redirect(destination("/dashboard/commerce", "error", error instanceof Error ? error.message : "Package could not be updated.")); }
  revalidatePath("/dashboard/commerce");
  redirect(destination("/dashboard/commerce", "success", "Coin package updated and audited."));
}

export async function submitCoinPackageStatus(formData: FormData) {
  const scope = await requirePermission("coin_packages.manage");
  const packageId = z.string().uuid().safeParse(formData.get("packageId"));
  if (!packageId.success) redirect(destination("/dashboard/commerce", "error", "Package was not valid."));
  try { await setCoinPackageActive({ scope, packageId: packageId.data, active: formData.get("active") === "true" }); } catch (error) { redirect(destination("/dashboard/commerce", "error", error instanceof Error ? error.message : "Package could not be updated.")); }
  revalidatePath("/dashboard/commerce"); redirect(destination("/dashboard/commerce", "success", "Coin package status updated."));
}

export async function submitSellerProfile(formData: FormData) {
  const scope = await requirePermission("sellers.manage");
  const parsed = z.object({ sellerId: z.string().uuid(), verification: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"]), whatsapp: z.string().trim().max(20).optional(), availability: z.enum(["AVAILABLE", "OFFLINE"]), region: z.string().trim().max(80).optional(), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  const packageIds = formData.getAll("packageIds").map(String);
  if (!parsed.success || packageIds.some((id) => !z.string().uuid().safeParse(id).success)) redirect(destination("/dashboard/commerce", "error", "Check the seller contact, status, packages, and reason."));
  try { await updateSellerProfile({ scope, ...parsed.data, whatsappPublic: formData.get("whatsappPublic") === "true", packageIds }); } catch (error) { redirect(destination("/dashboard/commerce", "error", error instanceof Error ? error.message : "Seller could not be updated.")); }
  revalidatePath("/dashboard/commerce"); redirect(destination("/dashboard/commerce", "success", "Approved seller configuration saved."));
}

export async function submitCoinOrderTransition(formData: FormData) {
  const scope = await requirePermission("coin_orders.manage");
  const parsed = z.object({ orderId: z.string().uuid(), nextStatus: z.enum(["PAYMENT_PENDING", "SELLER_REVIEWING", "COMPLETED", "REJECTED", "CANCELLED"]), note: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/commerce", "error", "Choose a valid order status and add a clear review note."));
  let publicId = "";
  try { publicId = await transitionCoinOrder({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/commerce", "error", error instanceof Error ? error.message : "Order could not be updated.")); }
  revalidatePath("/dashboard/commerce"); revalidatePath("/dashboard/wallet"); revalidatePath("/dashboard/transactions");
  redirect(destination("/dashboard/commerce", "success", `Order ${publicId} updated. Any coin movement was committed atomically.`));
}

export async function submitFaceVerificationReview(formData: FormData) {
  const scope = await requirePermission("face_verification.manage");
  const parsed = z.object({ requestId: z.string().uuid(), decision: z.enum(["VERIFIED", "REJECTED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/face-verification", "error", "Choose a decision and provide a clear reason."));
  try { await reviewFaceVerification({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/face-verification", "error", error instanceof Error ? error.message : "Face verification could not be reviewed.")); }
  revalidatePath("/dashboard/face-verification"); revalidatePath("/dashboard/users");
  redirect(destination("/dashboard/face-verification", "success", `Face verification ${parsed.data.decision.toLowerCase()}.`));
}

export async function submitHostGender(formData: FormData) {
  const scope = await requirePermission("hosts.review");
  const parsed = z.object({
    hostId: z.string().uuid(),
    gender: z.enum(["FEMALE", "MALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination(`/dashboard/hosts/${String(formData.get("hostId") ?? "")}`, "error", "Choose gender and provide a clear reason."));
  try { await updateHostGender({ scope, ...parsed.data }); }
  catch (error) { redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "error", error instanceof Error ? error.message : "Gender could not be updated.")); }
  revalidatePath(`/dashboard/hosts/${parsed.data.hostId}`);
  revalidatePath("/dashboard/users");
  redirect(destination(`/dashboard/hosts/${parsed.data.hostId}`, "success", "Gender updated and audited."));
}

export async function submitCommerceSettings(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const optionalUrl = z.string().trim().url().optional().or(z.literal(""));
  const parsed = z.object({ minimumWithdrawal: z.coerce.number().int().positive(), whatsappMessageTemplate: z.string().trim().min(20).max(1000), supportUrl: optionalUrl, withdrawalPortalUrl: optionalUrl }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check the withdrawal minimum, WhatsApp template, and optional HTTPS URLs."));
  await saveCommerceSettings({ scope, ...parsed.data }); revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "Mobile commerce settings saved."));
}

export async function submitWithdrawalEconomy(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({
    slabDiamonds: z.coerce.number().int().positive(), totalUsdCents: z.coerce.number().int().positive(),
    hostUsdCents: z.coerce.number().int().nonnegative(), agencyUsdCents: z.coerce.number().int().nonnegative(),
    superAdminUsdCents: z.coerce.number().int().nonnegative(), adminUsdCents: z.coerce.number().int().nonnegative(),
    bdUsdCents: z.coerce.number().int().nonnegative(), countryManagerUsdCents: z.coerce.number().int().nonnegative(),
    companyUsdCents: z.coerce.number().int().nonnegative(), usdInrRate: z.coerce.number().positive().max(1000),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check every withdrawal allocation, FX rate, and the change reason."));
  const { reason, ...value } = parsed.data;
  try { await saveWithdrawalEconomy({ scope, reason, value }); }
  catch (error) { redirect(destination("/dashboard/settings", "error", error instanceof Error ? error.message : "Withdrawal economics could not be saved.")); }
  revalidatePath("/dashboard/settings"); revalidatePath("/dashboard/withdrawals");
  redirect(destination("/dashboard/settings", "success", "Withdrawal slab, split, and FX rate saved for future completed withdrawals."));
}

export async function submitPayoutMethodReview(formData: FormData) {
  const scope = await requirePermission("withdrawals.review");
  const parsed = z.object({ methodId: z.string().uuid(), decision: z.enum(["VERIFIED", "REJECTED"]), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/withdrawals", "error", "Choose a payout-method decision and provide a clear reason."));
  try { await reviewPayoutMethod({ scope, ...parsed.data }); } catch (error) { redirect(destination("/dashboard/withdrawals", "error", error instanceof Error ? error.message : "Payout method could not be reviewed.")); }
  revalidatePath("/dashboard/withdrawals"); redirect(destination("/dashboard/withdrawals", "success", `Payout method ${parsed.data.decision.toLowerCase()}.`));
}

export async function submitDailyRewardRules(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({
    day1: z.coerce.number().int().nonnegative(), day2: z.coerce.number().int().nonnegative(),
    day3: z.coerce.number().int().nonnegative(), day4: z.coerce.number().int().nonnegative(),
    day5: z.coerce.number().int().nonnegative(), day6: z.coerce.number().int().nonnegative(),
    day7: z.coerce.number().int().nonnegative(), reason: z.string().trim().min(5).max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Configure seven non-negative reward amounts and a reason."));
  const { reason, ...days } = parsed.data;
  await saveDailyRewardRules({ scope, coins: Object.values(days), reason });
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "Daily Reward rules saved and audited."));
}

export async function submitDiamondConversionRule(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({ diamonds: z.coerce.number().int().positive(), coins: z.coerce.number().int().positive(), minimum: z.coerce.number().int().positive(), maximum: z.coerce.number().int().positive(), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check the diamond step, coin output, bounds, and reason."));
  try { await saveDiamondConversionRule({ scope, ...parsed.data }); }
  catch (error) { redirect(destination("/dashboard/settings", "error", error instanceof Error ? error.message : "Diamond conversion rule could not be saved.")); }
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "Diamond → Coin rule saved and audited."));
}

export async function submitHostRewardRules(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  const parsed = z.object({ face: z.coerce.number().int().nonnegative(), party: z.coerce.number().int().nonnegative(), minimumEligibleSeconds: z.coerce.number().int().min(1).max(3600), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/settings", "error", "Check the hourly rates, eligibility seconds, and reason."));
  // Keep the retired LIVE database rule synchronized only for old sessions
  // that may still reference it; the panel and mobile API expose Face only.
  await saveHostRewardRules({ scope, ...parsed.data, live: parsed.data.face });
  revalidatePath("/dashboard/settings");
  redirect(destination("/dashboard/settings", "success", "Host reward rules saved and audited."));
}

export async function submitFaceLiveAuthorization(formData: FormData) {
  const scope = await requirePermission("face_live.authorize");
  const parsed = z.object({ userPublicId: z.string().regex(/^\d+$/), authorizationType: z.enum(["AGENCY_FACE_LIVE", "SUPER_ADMIN_FACE_LIVE"]), approved: z.enum(["true", "false"]).transform((value) => value === "true"), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(destination("/dashboard/face-verification", "error", "Choose an authorization decision and provide a clear reason."));
  try { await setFaceLiveAuthorization({ scope, ...parsed.data }); }
  catch (error) { redirect(destination("/dashboard/face-verification", "error", error instanceof Error ? error.message : "Face Live authorization could not be saved.")); }
  revalidatePath("/dashboard/face-verification");
  redirect(destination("/dashboard/face-verification", "success", "Face Live authorization saved and audited."));
}
