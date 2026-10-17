# 2.4.93+7405 — measured release evidence

## Source and deployed backend

Mobile: branch `production`, commit
`948c4b9a275685627d98e948b0f168807473ab40`.
Its build embeds SHA, branch, timestamp and tracked-source digest in About.
Complete local Git bundle verified; signing keys were not regenerated.

Backend reviewed work: `5c914ec`, `8b10567`, `7b691f7`, `532f417`,
`bdbdcffe4046c5bb9fb8c47285d3ce98b9c668c0` and atomic migration follow-up
`2263cacb852850615d39759df95a0768ffd04245`.
Production deployment used individually baseline-checked files, preserving its
existing local overlays rather than resetting its older Git checkout.

Verified private off-VPS backup: `nazraa-predeploy-20261017T133703Z`,
5,197,069,434 bytes. Rollback API image retained. Migration 0106 applied, zero
invalid existing gift assets. API reports ready. No MySQL, Redis, realtime,
worker, Caddy or OCI LiveKit restart/configuration change.

Current production beauty/landmarks enabled, saved default strength 78 preserved.
Princess quote mode was held until quote-aware APK distribution was verified;
the final activation is recorded below.

## Confirmed defects, not speculative patches

- Fractional heartbeat seconds were lost at every checkpoint; 100 × 20.9 s
  became 2,000 s instead of 2,090 s. Remainders now survive checkpoints.
- Receipt-order provider state let delayed old departures erase republished
  tracks and repeated video evidence reset an uncommitted publishing cursor.
- Numeric DB Host ID versus string LiveKit identity skipped Host evidence.
- Widget-owned sample age restarted on recreation. Monotonic age now belongs
  to the canonical server sample, shared by elapsed/reward display.
- Empty allowed-source list with canPublish=true was misread as mic denial.
- Native RGB frames borrowed a camera converter without retaining its source
  buffer: repeated camera switching reproduced a native WebRTC abort. A source
  lease now survives until final RGB release; invalid GL entries are rejected.
- SDK cleanup emitted clientInitiated before stateMismatch. Only explicit app
  Leave and authoritative kick/deletion/duplicate identity now terminate the
  application session; unsolicited cleanup recovers.

Existing 3,500 amount, gender rules, daily cap, claim-only behavior and reward
audit source were not changed. Integration provider evidence crossed the real
threshold and generated exactly one claimable reward without a Flutter finish;
duplicate unpublish did not duplicate it. The production audit found zero
eligible decisions without entitlements, but cannot reconstruct historical
discarded fractions or unobserved publishing intervals.

## Completed automated checks

- Flutter 404 tests passed, including goldens and rapid 20-tap betting;
  analyze clean; touched Dart formatting clean; release provenance guard test
  rejects dirty/wrong-branch/missing/stale definitions.
- Android native 10 tests passed: masks, OES 720p output, source lifetime,
  shader behavior, beauty strength benchmark and PAG transparency/disposal.
- Backend full isolated core-mobile DB suite, Control 30 groups/eight roles,
  migrations, role matrix, game RTP checks, TypeScript and Next production
  build passed. Touched-file ESLint passed. Repository-wide legacy lint is not
  clean: 391 errors and 2,022 warnings outside this scoped pass.

## Beauty measurements and limits

Own full-size GPU pipeline, Google MediaPipe Apache-2.0 dense analysis/masks,
protected detail, stronger skin-specific smoothing/fairness/evenness/blemish,
under-eye, lips, blush/glow and relight. No paid SDK or server frame processing.
No face geometry manipulation. Master has ten bounded remote tuning controls.

Android 16 emulator uses ANGLE Vulkan SwiftShader, not a physical Android GPU.
720×1280 OES benchmark (40 frames/case), p50/p95 ms:
OFF 13.06/19.48; 25% 45.43/321.95; 50% 45.15/57.47;
75% 48.17/243.81; 100% 51.68/319.35; low 100% 21.27/29.40.
Full path misses 30-FPS budget on this software renderer; low fallback reduces
work without reducing output resolution. Actual synthetic camera publication
about 4–9 FPS is not a physical phone 30-FPS certification. No hardware phone
battery/thermal/lighting/skin-tone matrix is claimed.

PAG: official Apache-2.0 libpag 4.5.98-noffavc, bounded native texture renderer,
verified HTTPS/hash/version cache, existing compact-game/PK arbiter preserved,
16-KiB arm64 ELF alignment. Upstream logo is test-only; no new owned production
PAG artwork has been supplied or published.

## Princess simulation

See `PRINCESS_QUOTED_RTP.json`: one million fresh private CSPRNG deals over 128
uniformly sampled public first-card states; not one million unique public
states. Theoretical RTP 96.9956883545%, observed 97.2124600701%, observed edge
2.7875399299%, variance 1.2632741479, SE 0.0011239547, wins/losses
441,906/558,094, 126 payout values. No wager-dependent outcome generation.
Outcome/quote commitment and quote-ID financial idempotency tested. Historical
fixed-odds snapshots and Teen Patti Pro remain unchanged.

## Final artifact and runtime gate

Signed APK/AAB and prolonged-session completion are recorded below only after
verification. The public 2.4.92 artifact remains available until replacement.

### Prolonged transport/native run completed

Android 16 `.mediaqa`, actual production Host adapter plus SDK-only viewer and
audio Guest, local LiveKit 1.13.7: 1,800 seconds completed, 38 front/back camera
switches, 20 audience join/leave cycles, 10,304 processed beauty frames, maximum
one attached beauty processor, same Nazraa session start throughout, four
recoveries and zero harness assertions failed. Android native crash buffer empty.
Final camera/microphone remained published, 1280×720 beauty output with rotation
carried to 720×1280 encoder. Test teardown disposed Host/viewer/Guest resources.

10-second and 30-second loopback-server interruptions recovered. Android's
emulated Wi-Fi→cellular→Wi-Fi handoff recovered; this is not physical mobile
carrier testing. SDK official full reconnect at 19:25:18.277 recovered at
19:25:20.499 (2.222 s); transitional participant departure ignored. The fixed
unsolicited SDK-cleanup path at 19:33:22.366 recovered publication by
19:33:24.829 (2.463 s), without terminal logout. App background/resume exercised.

Important qualification: this was an engineering diagnostic run, not a claim of
30 minutes without any intermediate fault. It found and corrected the cleanup
classification while running. An invalid initial direct Engine restart test
raced SDK recovery and produced a disposed-peer error; that injection was
discarded and replaced by the official SDK debug scenario. A hot-reload method
rename also produced a debugger-only stale-closure lookup, repaired by retaining
the existing wrapper and replacing the test transport. Neither is hidden as a
clean production QA result. The final compiled release is tested separately.

Three clients share one debug process and SwiftShader: observed roughly
450 MB-class PSS, latest 455,157 KiB PSS / 498,912 KiB RSS, sampled process CPU
55.1% (four-vCPU emulator scale). These are not a single physical Host's battery,
hardware-GPU or production-release memory figures. Full production two-account
seat/payment E2E is not inferred from this local transport harness.

### Signed artifacts and public distribution completed

- Version 2.4.93+7405, package `com.nazraa.live`, min SDK 24 / target SDK 36.
- APK `Nazraa-Live-2.4.93-7405-release.apk`, 239,830,662 bytes.
  SHA-256 `37bf0bc21fce2588a3beb8bae93adf1d8241aa7ff294ac39144a797fce127401`.
- AAB `Nazraa-Live-2.4.93-7405-release.aab`, 186,566,412 bytes.
  SHA-256 `fe517cdba338502bbae9666ee6ad0f5db8baef9aec056247472d475b3afba5f8`.
- APK signature verified; AAB reports `jar verified`. Its normal self-signed
  upload-certificate chain warning is not a failed integrity verification.
  Both retain certificate SHA-256
  `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.
- Embedded provenance extracted from the final APK agrees with mobile commit
  `948c4b9a275685627d98e948b0f168807473ab40`, branch production, release,
  timestamp `2026-10-17T14:07:42.733Z`, source digest
  `9d5dc23d8934b644f9a99a354ae0825eac7689daa5db47fbccbb7af588b3a881`.
- Exact signed APK installed successfully on Android 16. Existing authenticated
  Home opened; a real production Face Host video rendered; Gift panel loaded
  and targeted that Host correctly; Party connected, seats/feed loaded and
  Princess opened without replacing the media surface. No production wager or
  gift was sent to an unrelated user's room for this smoke test.
- This existing account is not face-verified, and its composer correctly
  requires automatic verification before Face Host creation. It was not
  promoted/bypassed to manufacture production Host QA. Host publish/reconnect
  transport coverage is the isolated real-adapter harness described above.
- GitHub public release published:
  https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.93
  APK, AAB and SHA256SUMS uploaded. GitHub asset digests agree. Full public APK
  streamed back and its SHA-256 matches the local signed artifact.
- https://nazralive.in/download and /release/latest show 2.4.93 / 7405 with the
  correct public APK URL, size and checksum. Screenshot saved alongside report.
- Remote latestVersion updated to 2.4.93; minimumVersion remains 2.1.0.
  Maintenance and all protected non-mobile settings preserved by audited helper.
- Princess PUBLIC_QUOTE_V3 enabled by owner-authorized audited maintenance only
  after artifact verification: target RTP .97, gross cap 30×. Other game config
  bytes remain unchanged; old round/payout snapshots were not repriced. Exact
  release then displayed three real open first cards and six-decimal quotes
  (observed 2.760868× / 3.269130× / 3.012924×). Existing older apps need this
  release to bet in quote rounds; unsupported missing quote IDs fail before
  debit, rather than exposing undisclosed odds.

### Remaining measurement/content limits

No hardware midrange/flagship FPS, battery or thermal certification; no complete
human lighting/skin-tone/movement matrix. No new owned production PAG artwork
was supplied. Diagnostics are local allowlisted counters/trace, not a fleet
analytics dashboard. Production two-account Host/Guest financial E2E was not
performed, and is not represented by container health or the loopback test.
These limits are explicit; the published artifact is not claimed error-free
under every physical device/network condition.
