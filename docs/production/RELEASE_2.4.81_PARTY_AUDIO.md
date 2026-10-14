# Nazraa 2.4.81+7393 — Party/Audio completion

Status: implementation and automated tests passed; production deployment and
public release verification in progress. Do not treat this as a published build.

## Scope

- Preserve the 2.4.80 canonical Agency remove/rejoin and Control-only withdrawal
  work, and the durable Party Board History. No new withdrawal UI/formula.
- Party-only compact top record/member/social controls, constraint-driven seat
  layout, 20 seats as 4 × 5, compact recent chat/expandable sheet, safe local
  Rocket docking, seven seat-local expressions, existing music and games.
- Party Rocket uses the existing committed cycle identity/progress/reward.
  Its GPU/vector overlay stages ready → blue engine → upward launch → trail →
  celebration → Nazraa logo → existing completion → cleanup. The shared arbiter
  converts it to a compact notice over games/PK/modals; no financial decision
  is made by Flutter.
- Independent Audio PK session/link/Gift attribution tables. No Face PK table,
  reward policy, routing method or Flutter Face PK implementation changed.
  Both base Party rooms/publishers remain; a subscribe-only opposing connection
  receives only microphone tracks. Approved seats and Hosts may publish in their
  original room; audience/bridge tokens cannot publish.
- Server 5/10/30-minute timing, 20-second result, idempotent rematch/cleanup,
  actual committed Diamond scores and session Top 3. Active discovery is derived
  from current state plus endsAt, not a stale permanent room flag.
- Control/economy, Live history calculations/UI, Face transport/beauty, SDK
  versions, existing room grace and startup campaign remain unchanged.

## Automated evidence

- Flutter analyze clean; **281 Flutter tests PASS** including the added Audio PK
  phase/small-screen/Rocket tests. Focused room/navigation suite: **27 PASS**.
- Visual baselines intentionally changed only for the owner-requested PK Home
  filter and Party layout. Existing Profile golden SHA-256 remains
  `32a7dbc5c38800cc31708c4627679b3168ea7a24da92425b5633f5bc39a0ff4a`.
- Backend full core, Agency lifecycle, Party Board accounting, financial Gift
  transactions/Rocket, Face PK audio/rewards, games/settlement tests passed.
- Control **30 groups / 8 roles PASS**; role matrix and 9 PK streak cases PASS;
  game RTP model unchanged. Production Next build/typecheck PASS.
- Audio PK isolated DB/multi-identity tests: Friend/Random, reject/accept/retries,
  5/10/30, Red/Blue, bridge membership denial, mic-only seat/Host grant, muted
  identity, passive publish denial, actual Gift Diamond rounding, Top 3 and
  duplicate Gift protection, 20-second result, rematch accept/decline/timeout,
  unchanged original Board IDs and cleanup; self-expression spam control.

These are factual test scopes. Actual cross-room received audio samples, exact
released APK smoke, public download/hash and deployment evidence must be added
before changing this status to complete.

## Deployment safeguards

Only migration 0102 is additive. Guard critical setting digests, preserve the
dirty production source and previous image, verify the existing private OCI
predeploy backup, then recreate only API. Never restart LiveKit/base rooms.
Keep 2.4.80 download/minimum version until the 2.4.81 artifact/backend gates pass.

Implementation source: `7c7d8f3`. Local mobile source is not a Git checkout;
retain a sanitized source archive and exact signed binaries before publication.

## Remaining verification

Private offsite predeploy backup; source/API rollout; MariaDB schema 0102;
LiveKit synthetic multi-client sample reception/mute/cleanup; exact signed
Android 16 APK Party/settings/games/history/Face smoke; public GitHub/site file
checksum; latest-version pointer and rollback evidence.
