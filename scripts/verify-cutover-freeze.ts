import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const previous = process.env.NAZRAA_CUTOVER_FREEZE;
const previousBridge = process.env.NAZRAA_LEGACY_BRIDGE;
const previousWebhookBridge = process.env.NAZRAA_LIVEKIT_WEBHOOK_BRIDGE;
try {
  const request = (path: string, method = "GET") =>
    new NextRequest(`https://nazraa.vercel.app${path}`, { method });

  delete process.env.NAZRAA_CUTOVER_FREEZE;
  delete process.env.NAZRAA_LEGACY_BRIDGE;
  delete process.env.NAZRAA_LIVEKIT_WEBHOOK_BRIDGE;
  assert.notEqual(proxy(request("/api/v1/mobile/rooms", "POST")).status, 503);

  process.env.NAZRAA_CUTOVER_FREEZE = "1";
  for (const [path, method] of [
    ["/api/v1/mobile/rooms", "POST"],
    ["/api/v1/mobile/games", "GET"],
    ["/api/cron/monthly-host-reset", "GET"],
    ["/api/internal/livekit/webhook", "POST"],
    ["/dashboard/withdrawals", "POST"],
  ]) {
    const response = proxy(request(path, method));
    assert.equal(response.status, 503, `${method} ${path} escaped the fence`);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(proxy(request("/api/v1/config")).status, 503);
  assert.notEqual(proxy(request("/api/internal/health")).status, 503);
  assert.notEqual(proxy(request("/download")).status, 503);
  process.env.NAZRAA_LEGACY_BRIDGE = "1";
  for (const [path, method] of [
    ["/api/v1/mobile/rooms?roomId=42", "POST"],
    ["/api/v1/mobile/games", "GET"],
    ["/api/v1/config", "GET"],
    ["/api/public/account-deletion", "POST"],
  ]) {
    const response = proxy(request(path, method));
    assert.equal(response.status, 200, `${method} ${path} was not bridged`);
    assert.equal(
      response.headers.get("x-middleware-rewrite"),
      `https://api.nazraa.pixtra.site${path}`,
      `${method} ${path} reached the wrong authority`,
    );
  }
  for (const [path, method] of [
    ["/api/cron/monthly-host-reset", "GET"],
    ["/api/internal/livekit/webhook", "POST"],
    ["/api/reports/transactions", "GET"],
    ["/dashboard/withdrawals", "POST"],
  ]) {
    assert.equal(proxy(request(path, method)).status, 503);
  }
  process.env.NAZRAA_LIVEKIT_WEBHOOK_BRIDGE = "1";
  const webhook = proxy(request("/api/internal/livekit/webhook", "POST"));
  assert.equal(webhook.status, 200);
  assert.equal(
    webhook.headers.get("x-middleware-rewrite"),
    "https://api.nazraa.pixtra.site/api/internal/livekit/webhook",
  );
  assert.equal(proxy(request("/api/internal/livekit/webhook", "GET")).status, 503);
  assert.equal(proxy(request("/api/cron/monthly-host-reset", "GET")).status, 503);
  console.log("PASS cutover fence and explicit legacy public-API bridge route to one authority");
} finally {
  if (previous === undefined) delete process.env.NAZRAA_CUTOVER_FREEZE;
  else process.env.NAZRAA_CUTOVER_FREEZE = previous;
  if (previousBridge === undefined) delete process.env.NAZRAA_LEGACY_BRIDGE;
  else process.env.NAZRAA_LEGACY_BRIDGE = previousBridge;
  if (previousWebhookBridge === undefined) delete process.env.NAZRAA_LIVEKIT_WEBHOOK_BRIDGE;
  else process.env.NAZRAA_LIVEKIT_WEBHOOK_BRIDGE = previousWebhookBridge;
}
