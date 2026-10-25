import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";

// Scalar operational facts only: no arbitrary SDK payload, IP, SSID or media.
export const roomCloseContextSchema = z.object({
  appVersion: z.string().regex(/^\d+\.\d+\.\d+\+\d+$/).max(32),
  cameraOn: z.boolean(),
  beautyState: z.enum(["enabled", "disabled", "not_applicable", "unknown"]),
  liveKitState: z.enum(["connecting", "connected", "reconnecting", "disconnected", "unknown"]),
  networkType: z.enum(["wifi", "cellular", "ethernet", "vpn", "unknown"]),
  iceState: z.enum(["new", "checking", "connected", "completed", "disconnected", "failed", "closed", "unknown"]),
  reconnectAttempts: z.number().int().min(0).max(10000),
}).strict();
export type RoomCloseContext = z.infer<typeof roomCloseContextSchema>;

/** Telemetry is never an authorization, publication or reward signal. */
export function roomCloseAuditData(input: {
  roomId: string | null; sessionId: string | null; liveType: string;
  reason: string; source: string; phase: string; publishing: boolean;
  heartbeatAgeSeconds: number | null; context?: RoomCloseContext;
}) {
  const hash = (value: string | null) => value == null ? null
    : createHash("sha256").update(value).digest("hex").slice(0, 20);
  return {
    roomHash: hash(input.roomId), sessionHash: hash(input.sessionId),
    liveType: input.liveType, terminationReason: input.reason,
    eventSource: input.source, connectionPhase: input.phase,
    publishing: input.publishing,
    heartbeatAgeSeconds: input.heartbeatAgeSeconds,
    appVersion: input.context?.appVersion ?? "unknown",
    liveKitState: input.context?.liveKitState ?? "unknown",
    networkType: input.context?.networkType ?? "unknown",
    iceState: input.context?.iceState ?? "unknown",
    cameraState: input.context == null ? "unknown" : input.context.cameraOn ? "on" : "off",
    beautyState: input.context?.beautyState ?? "unknown",
    reconnectAttempts: input.context?.reconnectAttempts ?? null,
  };
}
