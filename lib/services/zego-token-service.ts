import "server-only";

import { createCipheriv, randomBytes, randomInt } from "crypto";

/**
 * Server-only ZEGO Token04 generator. The ServerSecret is read only from the
 * deployment environment and is never returned or logged.
 */
export class ZegoTokenService {
  constructor(
    private readonly appId = Number(process.env.ZEGO_APP_ID ?? 0),
    private readonly serverSecret = process.env.ZEGO_SERVER_SECRET ?? "",
  ) {}

  get isConfigured() {
    return Number.isSafeInteger(this.appId) && this.appId > 0 && Buffer.byteLength(this.serverSecret) === 32;
  }

  generateRoomToken(input: { userId: string; roomId: string; canPublish: boolean; ttlSeconds?: number; streamId?: string | null }) {
    if (!this.isConfigured) throw new Error("ZEGO server token signing is not configured.");
    const ttlSeconds = Math.min(7200, Math.max(300, input.ttlSeconds ?? 3600));
    const createdAt = Math.floor(Date.now() / 1000);
    const expiresAt = createdAt + ttlSeconds;
    const payload = JSON.stringify({
      room_id: input.roomId,
      privilege: { 1: 1, 2: input.canPublish ? 1 : 0 },
      // Keep stream validation disabled until ZEGO has explicitly enabled the
      // Published Stream ID authentication feature for this project. Server
      // media roles still control the publish privilege below; sending a
      // stream list before ZEGO enables that product makes otherwise-valid
      // RTC room logins fail on production devices.
      stream_id_list: null,
    });
    const plainText = JSON.stringify({
      app_id: this.appId,
      user_id: input.userId,
      nonce: randomInt(-2147483648, 2147483647),
      ctime: createdAt,
      expire: expiresAt,
      payload,
    });
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", Buffer.from(this.serverSecret), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const expires = Buffer.alloc(8); expires.writeBigInt64BE(BigInt(expiresAt));
    const ivLength = Buffer.alloc(2); ivLength.writeUInt16BE(iv.length);
    const encryptedLength = Buffer.alloc(2); encryptedLength.writeUInt16BE(encrypted.length);
    // App ID is public SDK configuration, not a credential. Returning it with
    // the token prevents a stale Android build from ever using a token signed
    // for a different ZEGOCLOUD application.
    return { appId: this.appId, token: `04${Buffer.concat([expires, ivLength, iv, encryptedLength, encrypted]).toString("base64")}`, expiresAt };
  }
}
