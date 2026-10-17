# Scoped Party rewards / music / persistent admins / gender

Companion mobile testing version: 2.4.97+7409. No public release requested.
Includes previously committed Country Manager presentation patch 660c155.
Keep production overlays/config and all unrelated dirty QA files.

## Focused local validation

`npx tsx scripts/verify-party-rewards-integration.ts`
creates ONLY a unique localhost QA schema, applies migrations, then drops that
exact generated schema. Never run this against a production DB host.

Checks first eligible interval, allowed RNG values, 12 concurrent claims yielding
one credit, identical/different retry IDs, rollback after injected post-wallet
failure, five-claim cap, same user after fresh identity/room changes, offline
gap exclusion, midnight split, >24h admin grant, board recreation and absent
revoke, gender fallback preservation/explicit change, owner-only music controls.

Root-cause fixes:

- Existing Party admin rows were permanent already but room-ID scoped; copying
  the previous board's canonical grants/revokes preserves restart authority.
- An absent inherited admin had no membership row and therefore could not be
  revoked; target lookup now permits the canonical grant for owner revocation.
- Implicit Edit Profile fallback gender was an unconditional SQL overwrite.
  Only explicitly confirmed gender changes now write, onboarding COALESCEs.
- Reward duplicate-row INSERT IGNORE + FOR UPDATE caused shared-to-exclusive
  lock-upgrade deadlocks under concurrent claims. The per-user upsert obtains
  the exclusive mutex first. Wallet/ledger/claim uniqueness are separate guards.
- Legacy room fallback referenced nonexistent created_at; it now uses started_at.
- YouTube previously only stored/opened a URL; no shared audio player existed.
  New owned-track player uses server state + WS and does not rip YouTube audio.

## Additive schema / endpoints

0107_party_coin_rewards.sql: per-user clock, per-day elapsed milliseconds,
per-interval claim/transaction/balance snapshot. Defaults are inserted only
through an existing active Master as required by system_settings.updated_by.
Timezone Asia/Kolkata; equal weights on 20/30/50/100; max 5 claims per day.

0108_party_music_state.sql: one versioned playback row per Party room.
Authenticated POST party-coin-reward and party-music, private/no-store responses.
No changes to existing Host Diamond entitlements, balances or reward caps.

## Deployment status

NOT DEPLOYED until access/baseline is revalidated. SSH times out before auth;
CUA explicitly reports local browser use disabled in Work settings.
Check the real server HEAD, dirty overlay and schema marker before applying.
Use a fresh verified off-VPS backup, preserve source patch and prior API image.
Apply only reviewed patches with git apply --check, never reset/checkout.
Run the scoped migration helper inside the existing API container, then rebuild
only API/worker using the existing /opt/nazraa/compose.yaml. No LiveKit,
Redis, database restart, DNS, public download, or remote mobile version change.
