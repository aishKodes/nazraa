import "server-only";

import type { MobileIdentity } from "@/lib/auth/mobile-session";

export type LiveAccessDecision = { allowed: boolean; reason: string };

function decision(allowed: boolean, reason: string): LiveAccessDecision {
  return { allowed, reason };
}

export class LiveAccessPolicyService {
  static for(identity: MobileIdentity) {
    const faceVerified = identity.faceVerificationStatus === "VERIFIED";
    const agencyApproved = Boolean(identity.agencyAccountId);
    const party = decision(faceVerified, faceVerified ? "Face verified." : "Complete automatic Face Verification to create a Party Live.");
    const video = decision(faceVerified, faceVerified ? "Face verified." : "Complete automatic Face Verification before hosting.");
    const face = decision(
      faceVerified && agencyApproved && identity.agencyFaceLiveAuthorized && identity.superAdminFaceLiveAuthorized,
      !faceVerified ? "Complete automatic Face Verification first."
        : !agencyApproved ? "Join an approved Agency to unlock Face Live."
          : !identity.agencyFaceLiveAuthorized ? "Your Agency must authorize Face Live access."
            : !identity.superAdminFaceLiveAuthorized ? "Super Admin authorization is still required."
              : "Face Live access active.",
    );
    return {
      browse: decision(true, "Browsing is available."),
      join: decision(true, "Joining other rooms is available."),
      chat: decision(faceVerified, faceVerified ? "Interaction unlocked." : "Complete Face Verification to use room chat and hosting interaction."),
      party,
      video,
      face,
      faceVerified,
      agencyApproved,
      agencyAuthorized: identity.agencyFaceLiveAuthorized,
      superAdminAuthorized: identity.superAdminFaceLiveAuthorized,
    };
  }
}
