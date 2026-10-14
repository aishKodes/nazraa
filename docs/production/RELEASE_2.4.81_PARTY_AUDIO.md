# Nazraa 2.4.81+7393 — Party/Audio completion

Status: **DEPLOYED AND PUBLISHED — 2.4.81+7393**, 2026-10-15 IST.
Official download: https://nazralive.in/download
Release: https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.81

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

- Flutter analyze clean; **282 Flutter tests PASS** including the added Audio PK
  phase/small-screen/Rocket/initial-offline-retry tests. Focused room/navigation
  suite: **27 PASS** before the final retry hardening; Audio PK focused: **16 PASS**.
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

Final client hardening: committed remote Gift/WS reconnect invalidations refresh
only the Rocket via a burst-coalesced notifier; no full Board rebuild. Opposing
Audio PK bootstrap failures retry with bounded 2/4/8/15-second backoff and cancel
on disposal; the original Party publisher/Room remains untouched.

## Actual media evidence

Official Node RTC SDK 1.1.0 and server SDK 2.19.0 ran against the existing
production LiveKit server from the VPS. Eight synthetic clients in two disposable
QA rooms published four distinct microphone sine waves. Eleven receiving audio
streams contained actual decoded nonzero samples. Host and seated-user audio
crossed in both directions; server-muted seat audio stopped while the other Host
continued. That same seat republished and reception recovered with a new SID.
Removing only opposing bridge participants preserved all four base publishers'
current track SIDs. Both synthetic rooms were deleted; final admin read found
zero QA_APK_ rooms. This is received-frame transport QA, not a claim of physical
two-phone listening.

The disposable Node environment initially lacked OS CA files; supplying the
standard VPS trust bundle fixed TLS without weakening certificate validation.
Production correctly denies administrator remote-unmute. QA respected that
restriction and tested seat republish recovery instead; it was not enabled.

## Deployment safeguards

Only migration 0102 is additive. Guard critical setting digests, preserve the
dirty production source and previous image, verify the existing private OCI
predeploy backup, then recreate only API. Never restart LiveKit/base rooms.
The gates passed before publication. Minimum version remains **2.1.0**,
maintenance false. Only latestVersion=2.4.81/updateUrl changed, with SYSTEM audit.

Implementation source: `7c7d8f3`. Local mobile source is not a Git checkout;
retain a sanitized source archive and exact signed binaries before publication.

## Production and exact-artifact verification

- Existing private OCI predeploy backup verified:
  `production/nazraa-predeploy-20261014T192249Z.sql.gz`, 4,811,667,263 bytes.
- Migration **0102_audio_party_pk.sql** applied after 0101. Before/after critical
  setting digests matched; no Face/economy/withdrawal/history policy mutation.
- Preserved dirty VPS source and previous API image; only API recreated.
  Worker, realtime, Caddy, MariaDB, Redis and OCI LiveKit were not restarted.
  API healthy; Audio PK route rejects unauthenticated calls with sanitized 401.
- Exact final signed APK installed over **2.4.78** in the existing Android 16
  release AVD without uninstall/data reset. VersionCode7393 confirmed.
- Launcher/session/Home/PK filter worked. Joined an actual Party as listener:
  compact top controls, current Members, Gift Record server date/time, local
  sound switch, game overlay open/close with continuing Board updates.
- Created a controlled QA Party through the normal owner UI. All 20 seats fit
  **4×5**, no Couple seats. Audio PK setup fetched real available Hosts and
  5/10/30 choices. No unsolicited invites sent to production Hosts.
- In-room settings restored 10 seats without replacing room identity.
  Canonical Close removed the QA Party from discovery. Final SQL read verified
  status ENDED and seat_count10; the saved QA profile was restored.
- Entered actual Face Live: remote Host video rendered; Gift catalog loaded
  and selected the Host recipient. Exited as viewer without ending Host Live.
- GitHub public asset digest and a complete VPS download both matched the
  installed final APK SHA-256. Public page visibly shows 2.4.81/build7393,
  exact URL, size, date and checksum; screenshot retained.

## Artifacts

APK: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.81-7393-release.apk`
224,491,809 bytes; SHA-256
`d6bc44d902ce3fc39e3779520649851286554f8dd9672bc916d31f37dd6cc89e`.

AAB: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.81-7393-release.aab`
177,680,686 bytes; SHA-256
`be04fdedbb9c1fc342036999eab86be154d74a400bb7043d5c7bf1f57b865e35`.

Package com.nazraa.live; min24/target36; permanent signing unchanged from 2.4.80.
APK certificate SHA-256:
`5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.

Sanitized final mobile source archive retained locally under
`docs/qa/20261015/party-audio/`; keys and generated ZEGO secrets excluded.
Private live-user screenshots and source archives are not committed/published.

## Rollback

Previous source archive, existing dirty patch, approved update, API image ID and
metadata live in `/opt/nazraa/backups/release-2.4.81/` (private directory).
Image: **nazraa-api:rollback-before-2.4.81**. 2.4.80 public asset remains available.
Rollback only the API image/public latest pointer if needed; retain additive
0102 tables and all durable financial/history data, never drop/restore DB over
live writes. No rollback was required.

## Limitations

No new physical listening, capacity certification or performance p50/p95 study
is claimed. Tests combine isolated MariaDB business/financial integration,
actual multi-client production transport and exact-APK runtime/visual smoke.
No known remaining release blocker in the requested Party/Audio scope.
