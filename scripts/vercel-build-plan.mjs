export function buildSteps(env) {
  const frozen = env.NAZRAA_CUTOVER_FREEZE === "1";
  const bridged = env.NAZRAA_LEGACY_BRIDGE === "1";
  if (bridged && !frozen) {
    throw new Error("Legacy API bridge requires the old database write fence.");
  }
  // Preview deployments must never run migrations or reviewer provisioning
  // against the production database. They also intentionally lack DB secrets.
  const buildOnly = frozen || env.VERCEL_ENV === "preview";
  return buildOnly
    ? [["npx", ["next", "build"]]]
    : [
        ["npm", ["run", "migrate"]],
        ["npm", ["run", "provision:play-reviewers"]],
        ["npx", ["next", "build"]],
      ];
}
