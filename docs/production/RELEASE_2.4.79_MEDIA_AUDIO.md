# Nazraa 2.4.79+7391 — media reliability and Audio Room upgrade

Released 14 October 2026, Asia/Kolkata. This is the implemented owner-approved
media/audio-room task, not another infrastructure migration.

## Distribution

- Public download: https://nazralive.in/download
- GitHub: https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.79
- APK: `Nazraa-Live-2.4.79-7391-release.apk`, 224,277,953 bytes.
- APK SHA-256: `1f117d59c3d50d3ccaee59084d2f5429c28821b77180651a1ebdf5faa697757b`.
- AAB: `Nazraa-Live-2.4.79-7391-release.aab`, 177,507,631 bytes.
- AAB SHA-256: `452c4759bd9af891b2e0d15eabfbda2837631005e105d84ddc2626b0dc9c8f12`.
- Both artifacts are under `/Users/aishwaryam/nazra2/dist/`.
- Package remains `com.nazraa.live`; target SDK 36; upload/signing key unchanged.
- Exact APK installed on the existing Android 16 emulator. Authenticated Home,
  production Face viewer video, a controlled production Party, Gift catalog,
  local sound, room edit/close and saved next-room defaults exercised.
- GitHub upload digest equals the local APK hash; public asset returns HTTP 200
  with the exact byte length. A separate full streamed re-download timed out
  after 87,801,108 bytes; its partial hash is NOT an artifact verification.
- Audited mobile config updated only `latestVersion=2.4.79` and the branded
  download URL. `minimumVersion=2.1.0`, reward/economy/media rules unchanged.
- AAB is ready locally. No claim of Play approval or Organization verification.

## Runtime and infrastructure retained

- Flutter 3.44.9 / Dart 3.12.2, vendored LiveKit Flutter 2.5.3,
  flutter_webrtc 1.2.0. No RTC SDK upgrade.
- Existing LiveKit v1.13.7, OCI Mumbai E6.Flex 2 OCPU / 8 GB / 50 GB boot.
- Existing Hostinger VPS API/MariaDB/Redis/realtime architecture retained.
- No LiveKit restart, resize, new paid media server or DNS/firewall changes.
- ZEGO Express/UIKit/prebuilt/plugin adapter removed from mobile dependencies,
  generated registrations and native runtime. Unused ZIM archived privately.
  Historical backend data and dormant legacy records were not deleted.

## Actual defects fixed

1. Gift refresh recursively called `_hydrateGiftCatalog`, causing unbounded
   recursion/loading failures. The narrow catalog hydrator now maps Gift data;
   it does not reset profile or wallet. Real HTTP regression passed.
2. Native beauty stopped processing after its three output buffers filled.
   The external WebRTC processor forwards a returned frame without releasing
   the processor's initial reference. Its owner reference is now released on
   the capture looper after synchronous downstream delivery; consumers retain
   their own references. Error paths return the borrowed pool entry and EGL
   context generation invalidates stale buffers. Probe processed 15 frames in
   eight seconds instead of stopping at three; output remained 1280x720.
3. Connection/auth and cleanup overlapped. Connection epochs and one serialized
   media gate prevent old cleanup or late auth from replacing a newer session.
4. Face/PK renderer identity could follow transient track/layout changes.
   Main media identity is stable across ordinary data updates and transitions;
   current republished track binds underneath that identity.
5. Presence reads held joined wallet/global-settings locks. The required room,
   member and accounting authority is locked narrowly; unrelated rows are not.
   A best-effort telemetry deadlock was deferred during concurrency QA without
   losing authoritative seats. This is not a claim of zero database contention.

## Media behavior and evidence

| Requirement | Evidence/status |
| --- | --- |
| Stable local renderer across Face/PK | PASS: widget integration, 20 transitions; one creation, no interim disposal |
| Stable remote Host/Guest tracks | PASS: loopback multi-client Host+viewer+audio Guest, 20 audience joins/leaves; stable Host SID and Guest mic |
| API/WS failure does not signal RTC reconnect | State separation preserved; API errors are not transport events |
| Frame freeze recovery | PASS deterministic health-monitor tests; affected renderer, then video track, before Room recreation |
| FIVE-minute grace / same reward ledger | Production 300-second config preserved; ledger regression passed |
| Face30 + PK30 =60 eligible minutes | PASS backend boundary/idempotency tests; no reward/session reset |
| Beauty OFF/ON | PASS emulator real WebRTC frame-processing probe, not physical skin-quality certification |
| HIGH/MEDIUM without Room recreation | PASS emulator live sender-parameter probe |
| Party output muted without muting Guest mic | PASS loopback multi-client and exact-APK Host UI |

Quality defaults are remotely read from `mobile.room_features.faceQuality`:
HIGH 720p portrait / 30 FPS / max3.5 Mbps; MEDIUM 720p /24 FPS /2.7 Mbps;
congested LOW540p /24 FPS /1.5 Mbps. The version-two kill switch is
`faceQuality.enabled=false`, restoring the previous VP8 720p/30/2.7M policy.
Codec options AUTO/VP8/H264 are supported; default remains VP8. AUTO considers
available native hardware H264 and publication failures fall back to VP8.
Congestion/CPU policy uses sustained samples and recovery hysteresis.
The main remote Face video keeps manual HIGH with adaptiveStream disabled.

Software-emulator loopback probe: sender720x1280@9 FPS, receiver720x1280@7 FPS,
quality limitation `none`; byte counters advanced. These are not 30-FPS
physical-device results. Weak Wi-Fi/mobile-network and two physical Host PK
observations remain follow-up, explicitly not an implementation gate.

## Audio Room

- Persistent owner title/theme/layout plus initial immutable session snapshot.
- In-room title/theme/layout edits use one versioned settings event; the same
  media connection and occupied seat identities remain.
- Lower-capacity layouts cannot remove occupied higher seat positions.
- Responsive seats-first layout, compact recent chat, expandable live feed,
  non-layout-consuming entry/Gift overlays and local Room Sound preference.
- Canonical Gift ledger supplies session Diamonds, separate Daily/Monthly
  Top5 and Top Fan; Face and Party contributions are scoped separately.
- Six real isolated QA Gift senders proved Top5 and cross-mode isolation.
  No fake ranking users or a second economy calculation.
- Profile navigation uses exact user identity; presence remains authoritative.

### Exact production APK check

Created one disposable QA Party with title `QA-Release-7391`, 20 seats and
an owned Nazraa cover. Gifts loaded. Room Sound Off kept the Host mic enabled.
Edited title to `QA-Release-7391--Updated`, selected 10 seats and enabled theme.
After save the same room remained active, with sound preference and Host mic
unchanged. Expanded/collapsed the feed, then closed the QA room.

Reopening the composer restored the edited title and 10 seats. Read-only
production readback confirmed config version2, saved profile, closed QA room,
historical snapshot still original title/20 seats, and signed LiveKit
`participant_joined` plus `track_published` events. No production financial
balance was altered for this smoke test.

## Startup campaign

- Master-only, audited upload/preview/enable/duration workflow; dedicated small
  asset storage preserves the legacy Gift asset constraints.
- Image normalization strips EXIF, bounds dimensions and stores optimized WebP.
- H264 MP4 duration 0.8–3 seconds, bounded dimensions, max2 MB, validated container.
- Config supplies version/checksum; download is background-only. Cold start uses
  a verified local cache or skips; Home and authentication are never awaited.
- Video is muted and optional. Missing/corrupt/expired cache is skipped.
- Production campaign is currently disabled (`campaign:null`); no unapproved
  marketing creative was published.
- Backend upload/checksum/disable/authorization tests and real 1.5-second H264
  fixture validation passed. Seven additional cache tests passed: none, image,
  video metadata, disabled, missing, same-size corruption, expiry.
- Physical startup-video playback and subjective creative preview are not
  claimed as physically observed. Code and automated coverage are complete.

## Performance — measured, not inferred

Cold Android Activity first-frame `am start -W`, five samples per APK:

| | 2.4.78 | 2.4.79 |
| --- | ---: | ---: |
| Samples, milliseconds |3306,6472,3257,1991,2256|2978,3346,3419,2271,5270|
| Median |3257|3346|
| Nearest-rank p95 (also maximum at n=5) |6472|5270|

Small software-emulator samples are noisy; median is +2.7%, p95/max -18.6%.
No statistically sound speed/regression claim follows. Home and room functional
smoke passed, but fresh Home-usable and room-media p50/p95 were not sampled.
APK fell from308,207,527 to224,277,953 bytes (27.2% smaller). Bootstrap20 requests
coalesced to one; renderer20 transitions avoided repeated disposal. Runtime
instrumentation remains lightweight. No fabricated physical CPU/jank metrics.

## Tests and deployment

- Flutter analyze: no issues. Full Flutter suite: **261 PASS**.
- Backend typecheck/Next production build: PASS.
- Full core mobile/backend suite: PASS, including financial/idempotency, daily
  rewards, PK continuity, 30-round shared games and new Audio Room queries.
- Control integration: **30 groups PASS, eight roles**, including Master startup
  asset upload and authorization. PK streak nine regression tests PASS.
- Isolated MySQL9.6 tests: PASS. Local MariaDB Docker test could not start because
  the unrelated shared Docker disk was full; no unrelated containers deleted.
- Actual production MariaDB11.8.9 additive migration0100 applied successfully.
- API-only rebuild/deploy healthy. Realtime/worker/media services not restarted.
- Existing Home/Profile goldens unchanged; new Party golden visually reviewed
  before intentional update. Exact signed APK Android16 production smoke PASS.

## Backups and recovery

- Fresh encrypted off-VPS predeploy backup uploaded/verified before migration:
  `production/nazraa-predeploy-20261013T203502Z.sql.gz`, 4,691,733,638 bytes.
- OCI private Mumbai bucket `nazraa-prod-backups-mumbai-20260929`.
- Lifecycle `nazraa-nightly-30-days`: DELETE ordinary objects older than30 days
  only under inclusion prefix `production/nazraa-nightly-`.
- Exclusions: `*recovery*`, `*cutover*`, `*migration*`, `*predeploy*`.
- Owner-approved regional service permission is limited to this one bucket:
  metadata/list plus OBJECT_DELETE. No upload/overwrite/other-bucket privileges.
- Saved/read-back lifecycle:38 nightly, five other protected objects, zero
  eligible at activation, zero objects explicitly deleted by this task.
- Local backend rollback branch: `rollback/2.4.78-before-media-audio-upgrade`.
- Private mobile pre-upgrade archive retained; never added to Git/public releases.
- VPS `/opt/nazraa/backups/release-2.4.79/` preserves source, pre-existing dirty
  changes, previous metadata and image reference.
- Previous image tag `nazraa-api:rollback-before-2.4.79` retained. Rollback uses
  the saved API source/image, not destructive database restoration; additive
  migration0100 and user data remain. Reward/economy/authorization unchanged.

## Remaining scope boundaries

No known failing implementation/release gate remains in the available tests.
Physical FPS/quality, hardware H264 diversity, mobile-network reconnect and
subjective beauty observations remain follow-up; they are not fabricated PASSes.
Master browser session expired, so its actual owner UI was not manually
authenticated during final QA; role/storage/route integration passed.
Play Console Organization verification is outside this release implementation.
Existing paid resources were not expanded and unrelated business rules unchanged.
