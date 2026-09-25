import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "server-only"
        ? "next/dist/compiled/server-only/empty.js"
        : specifier,
      context,
    );
  },
});

async function main() {
  const { shouldPersistMobileLatency } = await import(
    "@/lib/observability/mobile-latency-store"
  );

  assert.equal(shouldPersistMobileLatency("POST:room-presence", 0.049), true);
  assert.equal(shouldPersistMobileLatency("POST:room-presence", 0.05), false);
  assert.equal(shouldPersistMobileLatency("POST:pk-battle", 0.049), true);
  assert.equal(shouldPersistMobileLatency("POST:pk-battle", 0.05), false);
  assert.equal(shouldPersistMobileLatency("POST:room-join", 0.099), true);
  assert.equal(shouldPersistMobileLatency("POST:room-join", 0.1), false);
  assert.equal(shouldPersistMobileLatency("POST:room-join", Number.NaN), false);

  console.log("PASS sampled mobile diagnostics without changing room or wallet state");
}

void main();
