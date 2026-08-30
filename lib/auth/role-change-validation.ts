import { z } from "zod";
import { isPanelCountry } from "@/lib/countries";
import { roles } from "@/types/platform";

const newAccount = z.object({
  fullName: z.string().trim().min(2, "Enter the new account's full name.").max(120),
  password: z.string().min(8, "The new account needs a password of at least 8 characters.").max(200),
});

export const roleChangeSchema = z.object({
  accountId: z.string().uuid("Reload the account page and try again."),
  expectedRole: z.enum(roles),
  role: z.enum(roles),
  parentAccountId: z.union([z.string().uuid(), z.literal("NEW_COUNTRY_MANAGER")], { errorMap: () => ({ message: "Select the account's new parent." }) }),
  childParentIds: z.record(z.enum(roles), z.union([z.string().uuid(), z.literal("NEW_ADMIN")], { errorMap: () => ({ message: "Select a parent for each group of downstream accounts." }) })),
  newCountryManager: newAccount.extend({ countryCode: z.string().refine(isPanelCountry, "Select a country for the new Country Manager.") }).optional(),
  newAdmin: newAccount.optional(),
  reason: z.string().trim().min(5, "Enter a reason of at least 5 characters.").max(500),
  confirmed: z.literal("yes", { errorMap: () => ({ message: "Confirm the role and hierarchy changes before saving." }) }),
});

export function parseRoleChange(formData: FormData) {
  const parentAccountId = formData.get("parentAccountId");
  const childParentIds = Object.fromEntries(roles.filter((role) => formData.has(`childParent_${role}`)).map((role) => [role, formData.get(`childParent_${role}`)]));
  return roleChangeSchema.safeParse({
    accountId: formData.get("accountId"), expectedRole: formData.get("expectedRole"),
    role: formData.get("role"), parentAccountId, childParentIds,
    newCountryManager: parentAccountId === "NEW_COUNTRY_MANAGER" ? { fullName: formData.get("newCountryManagerName"), password: formData.get("newCountryManagerPassword"), countryCode: formData.get("newCountryManagerCountry") } : undefined,
    newAdmin: Object.values(childParentIds).includes("NEW_ADMIN") ? { fullName: formData.get("newAdminName"), password: formData.get("newAdminPassword") } : undefined,
    reason: formData.get("reason"), confirmed: formData.get("confirmed"),
  });
}
