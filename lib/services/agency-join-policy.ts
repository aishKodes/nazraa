/** Account eligibility only. Online presence and last-login are irrelevant. */
export function agencyJoinPolicy(input: {
  agencyStatus: string;
  removed?: boolean;
  ownerStatus: string | null;
}) {
  if (input.removed || input.agencyStatus !== "ACTIVE") {
    return { canApply: false, message: "This Agency is currently unavailable." };
  }
  if (input.ownerStatus == null) {
    return { canApply: false, message: "This Agency's owner account link is unavailable. Please contact support." };
  }
  if (input.ownerStatus !== "ACTIVE") {
    return { canApply: false, message: input.ownerStatus === "SUSPENDED"
      ? "This Agency's owner account is suspended."
      : "This Agency's owner account is currently unavailable." };
  }
  return { canApply: true, message: null };
}
