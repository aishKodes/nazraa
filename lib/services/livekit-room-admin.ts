import "server-only";

import { RoomServiceClient, TrackType } from "livekit-server-sdk";

function managementUrl(value = process.env.LIVEKIT_URL?.trim() ?? "") {
  if (!/^wss?:\/\//i.test(value)) return "";
  return value.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}

/**
 * Server-to-server LiveKit moderation. This is deliberately never reachable
 * from Flutter: mobile clients first change Nazraa's authoritative membership
 * state, then this service immediately applies the matching media action.
 */
export class LiveKitRoomAdmin {
  private readonly url = managementUrl();
  private readonly apiKey = process.env.LIVEKIT_API_KEY?.trim() ?? "";
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET?.trim() ?? "";

  get isConfigured() {
    return Boolean(this.url && this.apiKey.length >= 4 && this.apiSecret.length >= 16);
  }

  private client() {
    if (!this.isConfigured) return null;
    return new RoomServiceClient(this.url, this.apiKey, this.apiSecret);
  }

  /** Disconnects a kicked participant and invalidates its presently issued token. */
  async removeParticipant(roomCode: string, publicId: string) {
    const client = this.client();
    if (!client) return { attempted: false, removed: false };
    try {
      await client.removeParticipant(roomCode, publicId, {
        // Revocation timestamps are seconds. A subsequent server-issued token
        // has a newer nbf and remains usable after the user is unblocked.
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      });
      return { attempted: true, removed: true };
    } catch {
      // The authoritative Nazraa block already prevents re-admission. A
      // participant may have left between the DB transaction and this RPC.
      return { attempted: true, removed: false };
    }
  }

  /** Mutes or unmutes every current audio track for a member, idempotently. */
  async setParticipantAudioMuted(roomCode: string, publicId: string, muted: boolean) {
    const client = this.client();
    if (!client) return { attempted: false, changed: false };
    try {
      const participant = await client.getParticipant(roomCode, publicId);
      const audioTracks = participant.tracks.filter((track) => track.type === TrackType.AUDIO);
      await Promise.all(audioTracks.map(async (track) => {
        if (track.muted !== muted) {
          await client.mutePublishedTrack(roomCode, publicId, track.sid, muted);
        }
      }));
      return { attempted: true, changed: audioTracks.some((track) => track.muted !== muted) };
    } catch {
      // Membership/role state remains the source of truth if this transient
      // management RPC races participant disconnect or server recovery.
      return { attempted: true, changed: false };
    }
  }
}
