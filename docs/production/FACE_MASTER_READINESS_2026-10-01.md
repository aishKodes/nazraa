# Face / Video Live master task — current evidence

## Release decision

**OWNER-AUTHORIZED DISTRIBUTION IN PROGRESS.** On 2026-10-01 the owner explicitly
requested immediate launch without a second emulator. The signed
`2.4.76+7388` APK/AAB are published at the GitHub `Nazraa-Releases/v2.4.76`
release; GitHub asset digests match both local SHA-256 values. Website and
remote latest-version activation follow only after artifact verification.
The automated checks and single-emulator smoke results below remain the
actual evidence; unperformed Host/Guest/phone-call acceptance is not PASS.

## Production backend

- Branch: `feature/face-live-master-redesign`.
- Deployed runtime commit: `b65f93a` (previous runtime: `ed2a3bf`).
- API: `https://api.nazraa.pixtra.site`; WS:
  `wss://ws.nazraa.pixtra.site/realtime`.
- Production database: `nazraa_final_20260929_070033`.
- Migration `0096_face_live_master.sql` applied after successful existing backup
  service execution (`Result=success`, `ExecMainStatus=0`).
- Follow-up configuration migration `0097_face_guest_capacity_config.sql`
  (source commit `934bb70`) applied atomically: public `maxFaceAudioGuests`
  aligned from the legacy four to three, with exactly one deployment audit.
  Lower owner-configured capacities are preserved and retries do not add audits.
  No containers were rebuilt/restarted; deployed runtime stays `b65f93a`.
  Exact setting backup:
  `/opt/nazraa/backups/production/face-room-features-pre0097-20261001.json`
  SHA-256 `f2ff94f7f1e0c4eb2fe6b1e0939c013b8bead6e450e4ca45207f69e691d2729c`.
  Before/after SHA-256 of JSON excluding only `maxFaceAudioGuests`:
  `472316bfdf24fd73eae886ff353e75c438a91bf84ab0c1d13c5b78212257b897`
  (identical). Public config independently returns capacity three.
- Backup: `/opt/nazraa/backups/production/nazraa-nightly-20260930T200919Z.sql.gz`
  and its checksum; existing encrypted OCI offload workflow preserved.
- Image: `nazraa-api:face-b65f93a`, also tagged `production-candidate`.
- Image manifest-list SHA-256:
  `1e673d2d4f5f8f21c7fd23e96000d71dc8fbf17779105d3f5eb908ae4502517c`.
- Only API/worker were redeployed. MySQL, Redis, realtime, Caddy and OCI
  LiveKit/TURN infrastructure were not restarted or reconfigured.
- API health returned `ready`; public config returned HTTP 200.
- Production read-only audit: migration 0096 present, six gift intent receipts,
  zero active Face rooms with more than three audio guests. These are health/
  integrity observations, not a substitute for manual acceptance.

### Rollback

The prior image remains `nazraa-api:rollback-ed2a3bf`.

```sh
docker image tag nazraa-api:rollback-ed2a3bf nazraa-api:production-candidate
docker compose -f /opt/nazraa/compose.yaml up -d --no-deps api worker
```

Migration 0096 is additive/backward-compatible. Do not drop new tables or
discard committed financial receipts during rollback.

## Implemented scope

- Face-only compact social UI: session Diamonds replaces Record, Daily/
  Monthly exactly Top 5, monthly Top Fan, limited stable-identity audience DPs,
  compact guest strip, real count/member list and profile actions.
- Session and ranking values derive from canonical committed Host gift Diamond
  credits, scoped by Host/session/business date. New session zero, same-session
  reconnect preservation, month rollover and per-Host isolation are tested.
- Atomic Single/ALL gifting. ALL resolves Host plus occupied guest seats on
  the server. Stable intent receipts deduplicate retries; no audience targets
  or partial multi-recipient financial writes.
- Persistent Host-to-Admin relation. Admin can moderate; accept/reject of Host
  audio requests remains Host-only. Explicit removal revokes role/badge.
- Server cap of three Face guests, transactional final-seat race protection,
  durable seat identity/version, Leave Seat remains room audience.
- Existing maintenance worker prunes only expired disconnected Face guest
  seats; recent media evidence/provider tracks preserve recoverable seats.
- Client fallback/parser also clamps Face guest capacity to three.
- Android OS audio-mode observer (no READ_PHONE_STATE, no call metadata,
  no competing audio-focus request). Face publication pauses during actual OS
  call modes while preserving Room/session/seat. Recovery checks current media
  authority and preserves previous camera/mic intent, including muted state.
- Publishing evidence can pause without falsely changing RTC connection to
  reconnecting or ending the durable Live session. Stale generation callbacks
  are ignored. Actual end-to-end call recovery has not yet been accepted.
- PK product layout/network/economy were not redesigned in this workstream.
- Existing LiveKit routing and current reward economics/config were preserved.

Current observed production Live rules remain `Asia/Kolkata`, 08:00–02:00,
3,500 claimable Diamonds for both configured genders, first eligible hour once
per business day, agency authorization required. Reconnect grace remains 60s;
background media grace remains 25s. Do not substitute earlier historical rules.

## Automated tests

- Flutter analyze: no issues.
- Latest focused Face/interruption/reconnect/RTC clock/seat/PK suite: **37 PASS**.
- Full Flutter suite: **235 PASS / 0 FAIL**, including all golden tests.
  The Party golden expected the obsolete media-configuration banner and omitted
  retained header/toolbar paint layers. After comparing with the exact APK's
  real Party screen, the test explicitly repaints the route before capture and
  only the Party baseline was intentionally corrected. Home and Profile
  baselines were not changed. Visual fixtures disable unmocked native Firebase
  registration, avoiding a pending retry timer unrelated to the visual test.
  These are test-only changes; the already built candidate bytes are unchanged.
  Logs: `/tmp/nazraa-face-final-flutter-tests.log` and
  `/tmp/nazraa-face-final-analyze.log`.
- Backend TypeScript/build, core mobile transaction suite, role suite and
  Control integration suite: PASS. Latest Control integration covers migrations
  0001–0097 and 29 groups, including capacity alignment, preservation and replay.
  Latest TypeScript check is clean. Config-only changes do not require an APK
  rebuild.
- After migration 0097 was added, isolated core-mobile and the eight-role
  permission suites were rerun: PASS. This includes canonical gifting,
  Face social/three-seat authority, session/reward and PK continuity scenarios.
  Logs: `/tmp/nazraa-face-capacity-core-mobile.log`,
  `/tmp/nazraa-face-capacity-integration.log`,
  `/tmp/nazraa-face-capacity-typecheck.log` and
  `/tmp/nazraa-face-capacity-roles.log`.
- Face DB scenarios: three-seat concurrent race; durable release; Single/ALL
  correct recipients/costs; concurrent retry once; changed-intent denial;
  insufficient-funds rollback; real multi-gifter exact Top 5; independent
  Daily/Monthly; month rollover; Top Fan; no cross-Host leak; new session zero;
  reconnect preservation; persistent Admin; denied Admin call acceptance and
  rejection; long-disconnect cleanup vs recoverable guest; idempotent cleanup.
- Redis event publisher and authenticated WebSocket transport suites: PASS
  against temporary local loopback Redis. That temporary Redis was stopped.
- Widget fixtures prove real-ID navigation, Top Fan priority/selection stable
  under reordered presence, 320/390/430px compact layouts, two ranking tabs,
  exactly five rows, and reactive gift targets excluding ordinary audience.

## Exact artifacts

Package `com.nazraa.live`, target SDK 36, min SDK 24. Existing upload/signing
key is unchanged. APK v2 signature verifies; AAB jar signature verifies and
certificate fingerprint matches the APK. Standard self-signed upload-key /
untimestamped-JAR warnings are not Google Play approval evidence.

- APK: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.76-7388-release.apk`
  SHA-256 `cdb738b45d8f1340f2bbfb003606387311e0fcefe4682a32813a0a82dfc64bd2`.
- AAB: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.76-7388-release.aab`
  SHA-256 `277010585947829b38926c1214af5aefbb08c1940d84755d1c086dbefb0db46d`.
- Signing certificate SHA-256:
  `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.
- Local source snapshot of identified Flutter/Android Face-related files:
  `/Users/aishwaryam/nazra2/dist/Face-master-2.4.76-7388-source.tgz`
  SHA-256 `70a9476ba3fd66717d8f14dd958bb076e8910db38d3e2dcb5e8480d583e3f91f`.
  It excludes signing files, generated ZEGO secrets and production secrets.
  It is a patch-scope snapshot, not a complete standalone Flutter project.
- Test-only visual correction snapshot:
  `/Users/aishwaryam/nazra2/dist/Face-master-2.4.76-7388-visual-validation.tgz`
  SHA-256 `032658043151407d611e361c2b628478c32d1b3860c6edf3d98db7e3cc25d306`.
  Contains the corrected visual fixture and reviewed Party golden only.

## Runtime evidence and unperformed acceptance

Exact APK installation and authenticated Home launch PASS on
`nazraa_release_qa_20260926` / emulator-5554 (Android 16). Package version is
confirmed 2.4.76/7388; AndroidRuntime fatal entries observed: zero.

The exact APK also created a controlled temporary Party through the ordinary
authenticated account and standard UI. Header, seats, toolbar and Host mic-on
state rendered correctly. This is creation/layout/state evidence, not proof of
listener audio transport. The Host then used **Close Room**. Production SQL
confirmed room `NZAHMSC2QGAI0IOXL` is `ENDED`, with zero current members and zero
active LiveKit media tracks. No gifts, bets or test financial writes were made.
Screenshots/UI evidence: `/tmp/qa-party-after.png`, `/tmp/qa-party-after.xml`,
`/tmp/qa-party-end.xml` and `/tmp/qa-party-close.xml`.

The protected `face-live-social` endpoint rejects unauthenticated requests with
HTTP 401; API internal health remains `ready`.

The current ordinary account `Aish` is not Face-verified. The actual app
correctly directs it to automatic Face Verification; it cannot validly start
Face Live. No verification/gender/agency/time-window/financial bypass was
created. A qualified Host session is needed (ordinary Host during configured
Live hours, or an existing specifically authorized reviewer override).

Still unverified against the exact artifact: Host camera/audio, viewer media,
guest request/accept/audio, real multi-client seat/presence/UI synchronization,
real Single/ALL gifts through the new sheet, Effects OFF while RTC voice
continues, Host/Guest transport interruption, phone-call/background recovery,
PK start/end continuity, and Face performance/video/audio continuity.

Both `emulator-5554` (`nazraa_release_qa_20260926`) and `emulator-5556`
(`nazraa_api36`) now have the exact signed candidate, version 2.4.76/7388.
The second emulator's startup was blocked by consent for a stale emulator crash
report. The documented `-crash-report-mode never` option resolved startup
without sending reports or wiping the AVD. Inspection confirmed its installed
2.4.62 app was our isolated loopback media probe (no Nazraa login); only that
probe app was replaced with the exact candidate. The first emulator's ordinary
account/login is preserved. The second is at standard Google sign-in awaiting
an existing qualified Host login. No protected credentials were extracted.
A separate stalled medium_phone process was stopped; its account data was not
deleted.

The owner's latest launch instruction supersedes the two-client release gate.
No authentication, Face-verification or Live-hour bypass was introduced.
The optional second emulator was stopped without deleting its AVD. Dedicated
two-client media and phone-call acceptance remain follow-up validation, not
completed tests or a claimed zero-bug guarantee.
