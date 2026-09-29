import { spawnSync } from "node:child_process";
import { buildSteps } from "./vercel-build-plan.mjs";

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
  if (result.status !== 0) process.exit(result.status ?? 1);
}
