import "server-only";

import { createHash } from "node:crypto";

export type FaceBiometricResult = {
  status: "VERIFIED" | "DUPLICATE" | "RETRY";
  provider: string;
  livenessScore: number | null;
  matchScore: number | null;
  duplicateSubjectId: string | null;
  providerFaceId: string | null;
  embeddingReference: string | null;
  retainReferenceImage: boolean;
  reason: string;
};

export class FaceBiometricService {
  async verify(input: { subjectId: string; consentVersion: string; frames: Buffer[] }): Promise<FaceBiometricResult> {
    if (input.frames.length !== 1) throw new Error("Capture one verification selfie.");
    if (input.frames.some((frame) => frame.length < 1_000 || frame.length > 2 * 1024 * 1024)) {
      throw new Error("The verification selfie must be a clear JPG under 2 MB.");
    }
    if (input.frames[0][0] !== 0xff || input.frames[0][1] !== 0xd8 || input.frames[0][2] !== 0xff) {
      throw new Error("The verification selfie must be a valid JPG image.");
    }
    const captureReference = createHash("sha256")
      .update(input.subjectId)
      .update(input.consentVersion)
      .update(input.frames[0])
      .digest("hex");
    return {
      status: "VERIFIED", provider: "nazraa-single-capture-auto", livenessScore: null,
      matchScore: null, duplicateSubjectId: null,
      providerFaceId: `capture-${captureReference.slice(0, 24)}`,
      embeddingReference: `sha256:${captureReference}`,
      retainReferenceImage: true,
      reason: "Verification selfie captured and approved automatically.",
    };
  }
}
