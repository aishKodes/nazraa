import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSteps } from "./vercel-build-plan.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.scripts["vercel-build"], "node scripts/vercel-build.mjs");
assert.deepEqual(buildSteps({}), [
  ["npm", ["run", "migrate"]],
  ["npm", ["run", "provision:play-reviewers"]],
  ["npx", ["next", "build"]],
]);
assert.deepEqual(buildSteps({ NAZRAA_CUTOVER_FREEZE: "1", NAZRAA_LEGACY_BRIDGE: "1" }), [
  ["npx", ["next", "build"]],
]);
assert.deepEqual(buildSteps({ VERCEL_ENV: "preview" }), [
  ["npx", ["next", "build"]],
]);
assert.throws(() => buildSteps({ NAZRAA_LEGACY_BRIDGE: "1" }));
console.log("PASS frozen Vercel build skips migrations and reviewer provisioning");
