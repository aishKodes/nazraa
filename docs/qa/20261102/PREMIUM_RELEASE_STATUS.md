# Owner release / Princess / premium effects — 2 November 2026

## Exact artifacts and rollout state

- Public completed release: **2.5.09+7421**, mobile commit `8f39becfbd9c` (normal production main.dart; no QA endpoint defines).
- Public download: https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.09/Nazraa-Live-2.5.09-7421-release.apk
- Public APK SHA-256: `60220797e5cde449266295ba0862824a712aaf423da4f548ba8437d539e2dad5`. GitHub's uploaded-asset digest and downloaded public checksum match. Full public APK re-download was too slow to finish; it is not reported as a completed second full-file hash.
- Completed follow-up candidate: **2.5.10+7422**, mobile commit `48b8585542bd9ad837a94b7a200228176ce949e8`.
- Candidate APK: `/Users/aishwaryam/nazra2/dist/production-2.5.10/Nazraa-Live-2.5.10-7422-release.apk`.
- Candidate APK SHA-256: `978ba77d2e3726a6971c8c52c30457fd7ce1fbabf858985f5f3c6fef990c6dcf`.
- Candidate AAB: `/Users/aishwaryam/nazra2/dist/production-2.5.10/Nazraa-Live-2.5.10-7422-release.aab`.
- Candidate AAB SHA-256: `96788d4f05a880934dc67b4abfd53b0954c80e6d4ab390856642ae8705d8b279`.
- Package `com.nazraa.live`, target SDK 36, production certificate SHA-256 `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4` unchanged.
- GitHub v2.5.10 is uploaded as a **draft**, not promoted. The public website still reports **2.5.07+7419**. Do not claim it has been updated.

## Completed baseline deployment

A fresh predeploy database backup was verified in the existing private OCI bucket before applying the completed staging delta. Backend runtime source through `3b5105598379210ff0f1c3e0a487ae1992a3fc2a` deployed successfully, API healthy, migrations `0112_owner_gifting_random_pk.sql` and `0113_room_music_lucky_gifts.sql` applied. Caddy, Redis, DB, worker and LiveKit were not restarted.

Rollback image: `nazraa-api:before-owner-completed-20261102`.
Rollback source: `/opt/nazraa/backups/owner-completed-20261102/source-before.tar.gz`.
Deployment record: `/opt/nazraa/tools/owner-completed-20261102/deployed.json`.

Prospective policy activation is **not verified**. Its maintenance script was corrected to provide the required `system_settings.updated_by` reference; every action is audited as SYSTEM. Do not assume the new defaults are active merely because code deployed.

## Coin Seller / role board failure

Root cause: COIN_SELLER was absent from both the backend room-create RBAC grants and Flutter's creator whitelist. Agency Manager also had a backend Party capability blocked in Flutter.

Fix preserves role identity, Face verification, Agency membership, hosting bans, room limits and account restrictions. No financial/moderation permissions added. Fixed internal reason codes contain no SQL, stack, token or private profile data.

Role checks: Normal User and Monitoring CS denied creation. Host, eligible Coin Seller, Agency Owner, Admin, Super Admin and Master retain Party/Face capabilities, with Face eligibility enforced. Agency Manager gets Party only. Country Manager/BD retain the existing API role mapping; permissions are not rewritten.

Direct HTTP test on disposable localhost MySQL: ordinary role → 403/ROLE_NOT_ALLOWED; same test account assigned Coin Seller → 201 Party; LiveKit audio_only Host token. Test role restored; no production roles changed.

## Princess UI / result / economics

- Four readable chips: 100, 1K, 10K, 100K; wallet checks and lossless rapid betting preserved.
- Stale prior-round events, backwards phases and lower result versions rejected.
- Repeated same-round wallet refresh no longer restarts the reveal animation.
- Server realtime payload includes immutable config version, authoritative winning item and RESULT_COMMITTED status after result persistence.
- New fair V5 rounds hide all cards during betting and commit the outcome/paytable before wagers.
- Owner requested a 5% fee. This yields **95% theoretical RTP**, not 90%, with a fair three-chair deck and 3× gross payout. No least-bet winner selection or player targeting was implemented.
- Latest 100,000 CSPRNG-deal simulation: RTP **94.64565%**, variance **1.8016211186070936**, highest payout **285 per 100 stake**, theoretical house edge **5%**. Independent chair counts: 33,209 / 33,310 / 33,481.
- Real isolated HTTP + settlement ledger: 100 on each chair → 300 wager, 300 gross, 15 fee, 285 net, wallet net −15. Repeated bet ID and repeated maintenance: one settlement, no duplicate debit/credit.
- Old V3/V4 commitments remain at their accepted 3% fee. Existing round snapshots retain economics. The new production config version is **not yet published**; retain production maintenance state until new backend/config is verified.
- Existing Master economy panel retains Today/7-day/30-day/custom settled-result reports, stakes, payouts, house result, samples, multipliers, max bet/payout, preview, version history and audit. Added prospective fee input; UI labels disclose the mathematical return. No user-specific outcome control exists.

## Premium frames / entry

Five original lightweight CustomPainter motion styles: Gold Royal, Diamond Blue, Fire, Neon, Dragon/VIP. Existing owned frame artwork and portrait geometry retained. No extra video decoder per avatar. One shared 20 Hz Ticker; offscreen, reduced-motion, inactive route and background pause; zero remaining frames disposes it. Test: 24 visible frames share one clock; hidden/disposed → zero.

Master artwork configuration adds a frame-motion style selector. AUTO resolves from the equipped frame's identity. No cosmetic entitlement or official role granted by this client feature. Country Admin Dragon remains Country Manager-only.

Existing entry queue/controller and server entitlement resolution reused. Premium banners remain bounded to 84 logical px and receive an original spotlight/trail painter. Games, PK and modals force compact noninteractive notices. Ordinary entries remain compact. No new full-screen entry route or room/media lifecycle added.

Frame visual proof: `/Users/aishwaryam/nazra2/test/goldens/premium_frame_styles.png`.

## Gift pipeline

Owned Golden Spotlight export: 156 catalogue gifts, 299 physical media files, 307,876,142 bytes (133 MP4, 153 WebP, 12 PNG, 1 JPG). Manifest-referenced content deduplicates to 293 SHA-256 values, 301,225,416 bytes. No GIF was present in this export; future GIF upload support was tested using a controlled two-frame alpha fixture.

Three optimized owned MP4 examples, 24 fps / bounded 8-second cinematic clips:
- tersul: 4,849,962 → 529,976 bytes;
- DEPA BOLE: 2,433,768 → 731,473 bytes;
- GOOD MORNING: 2,460,806 → 1,129,543 bytes.

Examples/inventory: `/Users/aishwaryam/nazraa-release-evidence/20261102-public-premium/gift-pipeline/`.

Complex MP4/WebM stays video in a clipped cinematic surface. No alpha claim or blind chroma-key/vector conversion. GIF → optimized animated WebP on upload, retaining alpha and frame timing, with MIME/frame/pixel/size/duration bounds. PAG/JSON/WebP remain supported; no fake PAG. GIF test confirms two frames, alpha, 250 ms timing, dimensions, malformed/MIME rejection.

Existing GiftAnimationPresenter, GiftCelebrationQueue, EffectAssetCache, EntryEffectQueue and NazraaEffectRenderer reused. Validated Control-owned video blobs get explicit BOUNDED_CINEMATIC metadata; arbitrary/legacy opaque video remains compact fallback. Face effects are bounded and moved below the main face area, clear of the guest rail/actions. Party gifts use one compact animated notice, away from seats/chat/controls. Game/PK/modal notices never start the heavy visual. Broken assets fall back compactly, without a coloured/full-room placeholder.

Cache remains version/checksum-based, 48 objects, two downloads, bounded video bytes and selector preload. Manifest content/duration/config changes now invalidate its version. Heavy 300-video library is not bundled into the APK. Existing room music and microphone publication are untouched; gift sound uses the existing short effect path.

Optimized examples have **not** been substituted into production catalogue records while maintenance access is unavailable. Existing assets remain intact.

## Focused validation

- Flutter analyze: no issues.
- TypeScript: passes.
- Princess suite: 21 tests, including 30-round progression, rapid 20-tap lossless batching, stale state guards, exact results, fees and reviewed game goldens.
- Effects/frames/rapid Lucky suite: 28 tests; frame gallery: 1 test. Total focused unique suite: 50.
- Role matrix, GIF pipeline, 100k simulation and real HTTP/ledger checks pass.
- Existing Lucky/music HTTP regression passes: durable 200 debit / 40 recipient Diamonds for the controlled Lucky gift, identical retry outcome, private weights absent, unauthenticated denial, music controller permissions and Host token.
- Exact 2.5.09 public APK: install, reviewer login, wallet read, populated Party, Face live video.
- Exact 2.5.10 candidate: production-signed update installs without clearing the session, profile/wallet, populated Party, Face/PK spectator video, safe leave back Home. No production wagers/gifts placed during these UI tests.
- PSS snapshots: 2.5.09 Face ~153 MiB, 2.5.10 Party ~153 MiB, 2.5.10 two-Host PK spectator ~173 MiB. Different scenes are not a controlled before/after benchmark. No physical-device/WAN or HiFi claim.

## Actual remaining blocker / resume point

After Codex/Mac restart, Hostinger web consoles remain blank, with no login/root prompt. Reload of an expired session explicitly reported "Session is expired or not found"; fresh hPanel sessions are also blank. SSH 22/2222 sometimes sends a banner but cannot complete a command (OpenSSH, independent SSH implementation and narrow protocol diagnostics tested). Existing firewall already permits this Mac's 203.110.247.52/32; no rule was added or changed. Master Control also opens at sign-in.

Need a functioning authenticated VPS shell, not another generic permission. Do not claim final backend patch, fee activation, public website/current/latest update or v2.5.10 promotion complete. Preserve existing production and permanent signing keys. Do not restart LiveKit, migrate infrastructure, change DNS, weaken SSH/TLS, rewrite wallets or silently alter existing rounds.

On recovery: inspect actual deployed state, apply only the reviewed runtime patch, rebuild/restart API only with backup/rollback protection, verify health, activate completed policy gates with SYSTEM audit, publish the prospective Princess configuration through the canonical versioned path, promote the verified APK, update website/current/latest (minimum remains unchanged), then verify the public URL/hash. Evidence and patch are preserved under `/Users/aishwaryam/nazraa-release-evidence/20261102-public-premium/`.
