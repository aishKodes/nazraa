import { WebhookReceiver } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import {
  normalizeLiveKitWebhookEvent,
  recordLiveKitMediaEvidence,
  type LiveKitWebhookEvent,
} from "@/lib/services/livekit-media-evidence";

export const dynamic = "force-dynamic";

function configuredWebhookCredentials() {
  return {
    apiKey: process.env.LIVEKIT_WEBHOOK_API_KEY?.trim() || process.env.LIVEKIT_API_KEY?.trim() || "",
    apiSecret: process.env.LIVEKIT_WEBHOOK_API_SECRET?.trim() || process.env.LIVEKIT_API_SECRET?.trim() || "",
  };
}

async function verifiedWebhook(request: Request, rawPayload: string) {
  const { apiKey, apiSecret } = configuredWebhookCredentials();
  const authorization = request.headers.get("authorization") ?? undefined;
  if (!apiKey || apiSecret.length < 16 || !authorization) return false;
  try {
    // Use the provider's receiver rather than reimplementing the signed JWT
    // envelope. It verifies the issuer, signature and body digest.
    await new WebhookReceiver(apiKey, apiSecret).receive(rawPayload, authorization);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // Webhooks are provider-to-provider traffic. A generic 404 avoids making
  // this endpoint discoverable to scanners and never returns credential or
  // schema details to the caller.
  const rawPayload = await request.text();
  if (rawPayload.length === 0 || rawPayload.length > 128 * 1024) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }
  if (!(await verifiedWebhook(request, rawPayload))) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }
  try {
    const event = JSON.parse(rawPayload) as LiveKitWebhookEvent;
    const evidence = normalizeLiveKitWebhookEvent(event, rawPayload);
    if (!evidence) return NextResponse.json({ accepted: true }, { status: 202 });
    await recordLiveKitMediaEvidence(evidence);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch {
    // Return an intentionally neutral transient response; the server can
    // safely retry because provider event ids are unique in MySQL.
    return NextResponse.json({ message: "Unavailable." }, { status: 503 });
  }
}
