import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const previous = process.env.NAZRAA_CUTOVER_FREEZE;
try {
  const request = (path: string, method = "GET") =>
    new NextRequest(`https://nazraa.vercel.app${path}`, { method });

  delete process.env.NAZRAA_CUTOVER_FREEZE;
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
  assert.notEqual(proxy(request("/api/v1/config")).status, 503);
  assert.notEqual(proxy(request("/api/internal/health")).status, 503);
  assert.notEqual(proxy(request("/download")).status, 503);
  console.log("PASS cutover fence blocks old mobile, game GET, cron, webhook and Control Server Action writes");
} finally {
  if (previous === undefined) delete process.env.NAZRAA_CUTOVER_FREEZE;
  else process.env.NAZRAA_CUTOVER_FREEZE = previous;
}
