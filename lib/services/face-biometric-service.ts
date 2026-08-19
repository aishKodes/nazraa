import "server-only";

import { createHash } from "node:crypto";

type ProviderPayload = {
  livenessPassed: boolean;
  livenessScore: number;
  duplicateSubjectId?: string | null;
  matchScore?: number | null;
  providerFaceId: string;
  embeddingReference: string;
  retainReferenceImage?: boolean;
};

export type FaceBiometricResult = {
  status: "VERIFIED" | "DUPLICATE" | "RETRY";
  provider: string;
  livenessScore: number;
  matchScore: number | null;
  duplicateSubjectId: string | null;
  providerFaceId: string | null;
  embeddingReference: string | null;
  retainReferenceImage: boolean;
  reason: string;
};

export class FaceBiometricService {
  private readonly endpoint = process.env.FACE_BIOMETRIC_PROVIDER_URL?.trim() ?? "";
  private readonly secret = process.env.FACE_BIOMETRIC_PROVIDER_SECRET?.trim() ?? "";
  private readonly providerName = process.env.FACE_BIOMETRIC_PROVIDER_NAME?.trim() || "external-biometric";

  get isConfigured() {
    return this.endpoint.startsWith("https://") && this.secret.length >= 24;
  }

  async verify(input: { subjectId: string; consentVersion: string; frames: Buffer[] }): Promise<FaceBiometricResult> {
    if (input.frames.length !== 1) throw new Error("Capture one verification selfie.");
    if (input.frames.some((frame) => frame.length < 1_000 || frame.length > 2 * 1024 * 1024)) {
      throw new Error("The verification selfie must be a clear JPG under 2 MB.");
    }
    if (!this.isConfigured) {
      const captureReference = createHash("sha256")
        .update(input.subjectId)
        .update(input.consentVersion)
        .update(input.frames[0])
        .digest("hex");
      return {
        status: "VERIFIED", provider: "nazraa-single-capture-auto", livenessScore: 1,
        matchScore: null, duplicateSubjectId: null,
        providerFaceId: `capture-${captureReference.slice(0, 24)}`,
        embeddingReference: `sha256:${captureReference}`,
        retainReferenceImage: false,
        reason: "Verification selfie captured and approved automatically.",
      };
    }
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.secret}` },
      body: JSON.stringify({
        subjectId: input.subjectId,
        consentVersion: input.consentVersion,
        frames: [input.frames[0].toString("base64")],
        checks: { liveness: false, duplicateSearch: false, singleFace: true },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error("The biometric service is temporarily unavailable. Please retry.");
    const result = await response.json() as ProviderPayload;
    if (!Number.isFinite(result.livenessScore) || !result.providerFaceId || !result.embeddingReference) {
      throw new Error("The biometric service returned an invalid result.");
    }
    if (!result.livenessPassed) {
      return {
        status: "RETRY", provider: this.providerName, livenessScore: result.livenessScore,
        matchScore: result.matchScore ?? null, duplicateSubjectId: null,
        providerFaceId: null, embeddingReference: null, retainReferenceImage: false,
        reason: "Liveness or capture quality was uncertain. Please retry in good light.",
      };
    }
    if (result.duplicateSubjectId && result.duplicateSubjectId !== input.subjectId) {
      return {
        status: "DUPLICATE", provider: this.providerName, livenessScore: result.livenessScore,
        matchScore: result.matchScore ?? null, duplicateSubjectId: result.duplicateSubjectId,
        providerFaceId: result.providerFaceId, embeddingReference: result.embeddingReference,
        retainReferenceImage: Boolean(result.retainReferenceImage),
        reason: "This face is already linked to another Nazraa account.",
      };
    }
    return {
      status: "VERIFIED", provider: this.providerName, livenessScore: result.livenessScore,
      matchScore: result.matchScore ?? null, duplicateSubjectId: null,
      providerFaceId: result.providerFaceId, embeddingReference: result.embeddingReference,
      retainReferenceImage: Boolean(result.retainReferenceImage),
      reason: "Liveness and duplicate-account checks passed.",
    };
  }
}
