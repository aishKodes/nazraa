import "server-only";

import type { MobileIdentity } from "@/lib/auth/mobile-session";

export type LiveAccessDecision = { allowed: boolean; reason: string };

function decision(allowed: boolean, reason: string): LiveAccessDecision {
  return { allowed, reason };
}

export class LiveAccessPolicyService {
  static for(identity: MobileIdentity) {
    const liveRestricted = identity.liveRestricted;
    const hostStatusRestricted = identity.hostProfileStatus != null
      && ["SUSPENDED", "INACTIVE"].includes(identity.hostProfileStatus);
    const hostingRestricted = liveRestricted || hostStatusRestricted;
    const restrictionReason = liveRestricted
      ? `Live hosting is restricted${identity.liveRestrictedUntil ? ` until ${identity.liveRestrictedUntil}` : ""}.${identity.liveRestrictionReason ? ` ${identity.liveRestrictionReason}` : ""}`
      : hostStatusRestricted
        ? "Hosting is suspended or inactive. Contact your Agency or Nazraa support."
        : "Hosting access active.";
    if (identity.hostAccessOverride) {
      return {
        browse: decision(true, "Owner test access active."),
        join: decision(true, "Owner test access active."),
        chat: decision(true, "Owner test access active."),
        party: decision(!hostingRestricted, hostingRestricted ? restrictionReason : "Owner test access active."),
        video: decision(!hostingRestricted, hostingRestricted ? restrictionReason : "Owner test access active."),
        face: decision(!hostingRestricted, hostingRestricted ? restrictionReason : "Owner test access active."),
        faceVerified: true,
        agencyApproved: true,
        agencyAuthorized: true,
        superAdminAuthorized: true,
      };
    }
    const faceVerified = identity.faceVerificationStatus === "VERIFIED";
    const agencyApproved = Boolean(identity.agencyAccountId);
    const partyAllowed = faceVerified && !hostingRestricted;
    const party = decision(partyAllowed, hostingRestricted ? restrictionReason : faceVerified ? "Face verified." : "Complete automatic Face Verification to create a Party Live.");
    // Face verification is the single authoritative verification decision.
    // The two legacy authorization columns are retained only for older app
    // versions and must never make a verified Host repeat approval in several
    // panels. Agency membership remains a separate business eligibility rule.
    const managedLiveAllowed = faceVerified && agencyApproved && !hostingRestricted;
    const managedLiveReason =
      hostingRestricted ? restrictionReason
        : !faceVerified ? "Complete automatic Face Verification first."
        : !agencyApproved ? "Join an approved Agency to unlock Face Live."
          : "Face Live access active.";
    const video = decision(managedLiveAllowed, managedLiveReason);
    const face = decision(managedLiveAllowed, managedLiveReason);
    return {
      browse: decision(true, "Browsing is available."),
      join: decision(true, "Joining other rooms is available."),
      chat: decision(faceVerified, faceVerified ? "Interaction unlocked." : "Complete Face Verification to use room chat and hosting interaction."),
      party,
      video,
      face,
      faceVerified,
      agencyApproved,
      // Backward-compatible response fields now reflect the canonical status,
      // so old clients do not display obsolete secondary approval locks.
      agencyAuthorized: faceVerified && agencyApproved,
      superAdminAuthorized: faceVerified,
    };
  }
}
