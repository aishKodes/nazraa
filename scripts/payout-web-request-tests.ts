import assert from "node:assert/strict";
import { payoutJsonRequest, payoutUiMessage } from "../lib/client/payout-request";
const original = globalThis.fetch;
const fallback = "Could not complete this action. Please retry.";
async function run() {
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init?.body, '{"idempotencyKey":"unchanged-request-id"}');
      return new Response('{"ok":true}', { status: 200 });
    };
    assert.deepEqual(await payoutJsonRequest("/test", { method: "POST", body: '{"idempotencyKey":"unchanged-request-id"}' }, fallback), { ok: true });
    assert.equal(calls, 1, "the transport never retries a financial command itself");
    for (const response of [
      new Response("<html>proxy failure</html>", { status: 502 }),
      new Response('{"message":"SQLSTATE connection exception HTTP 500"}', { status: 500 }),
      new Response('null', { status: 200 }),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(payoutJsonRequest("/test", {}, fallback), { message: fallback });
    }
    for (const error of [new TypeError("Failed to fetch"), new DOMException("timed out", "TimeoutError")]) {
      globalThis.fetch = async () => { throw error; };
      await assert.rejects(payoutJsonRequest("/test", {}, fallback), { message: fallback });
      assert.equal(payoutUiMessage(error, fallback), fallback);
    }
    globalThis.fetch = async () => new Response('{"message":"Insufficient Diamonds."}', { status: 400 });
    await assert.rejects(payoutJsonRequest("/test", {}, fallback), { message: "Insufficient Diamonds." });
    console.log("PASS payout web transport: success, no implicit write retry, identity preserved, bounded signal, offline/timeout/non-JSON/internal error sanitization, valid business denial.");
  } finally { globalThis.fetch = original; }
}
run().catch(() => { console.error("FAIL payout web transport"); process.exitCode = 1; });
