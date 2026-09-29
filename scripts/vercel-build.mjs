import { spawnSync } from "node:child_process";
import { buildSteps } from "./vercel-build-plan.mjs";

// An old Vercel deployment remains available for legacy APK/API routing, but
// it must not mutate the frozen shared database while the new VPS database is
// authoritative. The standard pre-cutover build behavior remains unchanged.
for (const [program, args] of buildSteps(process.env)) {
  const result = spawnSync(program, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(program === "npm" && args[1] === "provision:play-reviewers"
        ? { PLAY_REVIEW_PROVISION_OPTIONAL: "true" }
        : {}),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
