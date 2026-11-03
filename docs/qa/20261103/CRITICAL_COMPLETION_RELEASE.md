# Nazraa 2.5.14+7426 — production completion record

Date: 2026-11-03. Website: https://nazralive.in/download
Release: https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.5.14
Master artwork controls: https://nazralive.in/dashboard/role-visuals

## Exact source and artifacts

- Mobile source: `2440e51b4ef93d8380e99807791f970b99652351` (clean tracked tree at release build).
- Backend implementation: `50dd306a059202091d7d3f22e7583db0aba3040e`.
- Scoped deployed source/release target: `4b193918a044b3db5abe7bb1859b1b2694194ef9`, from prior deployed base `bcc2762f8fbdd538464927b72c11575add8fe092`. The existing production checkout was not reset or replaced.
- Video-metadata repair operation: `14785cdf153d39cf68ad5ec5e215236b8e705fc5`.
- APK: `Nazraa-Live-2.5.14-7426-release.apk`, 261,459,155 bytes.
- APK SHA-256: `6b36315d3154f89c894c072acd8182a96dbc138932bb6a429184bc6d28e0b001`.
- AAB: `Nazraa-Live-2.5.14-7426-release.aab`, 206,800,438 bytes.
- AAB SHA-256: `eacf21c79f62f2b8edfd499e9238a4637c1534d22a0253173872d5a429ad6292`.
- Android: `com.nazraa.live`, target 36, minimum 24, release signed with the existing certificate SHA-256 `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.
- GitHub confirms the same artifact digests. Independent full public download from the VPS completed in 35.48 seconds with the exact APK size and hash. The published website exposes this same version/build/link/hash.

## Changes and root causes

### Princess
Permanent Top 3 lists below every chair were removed. One relevant-chair result podium animates in/out inside the existing result phase, with rank, names, real portraits and settled daily Coin winnings. Podium DPs are 52/44 logical pixels, participant markers 20–28 responsive pixels. The original chair-specific crown/wing/ribbon animation remains. No game/RTP/fee/round timing changed.

### Pro
Public realtime timestamps could outrun private HTTP bet acknowledgements; a later public snapshot then replaced accepted-looking personal wagers with zeros. Private per-round accepted facts are merged monotonically, independently of public phase ordering. The 75 ms lossless batching remains. Sparse immutable retries now compare correctly to the expanded durable Pro receipt. Concurrent settlement uses a current locking read after waiting for bet locks, preventing a stale repeatable-read snapshot from attempting a second payout.

### Durable history / monthly statistics
The old Gift Record widget used only the transient current-room activity window. The new authenticated paginated read uses `live_room_gift_events` and existing sender/receiver indexes. Sent, received and current-room filters are distinct; all history and calendar-month statistics are separate. Monthly boundaries use the existing Asia/Kolkata period utility. No ledger/history rows were deleted or reset. Production DB session is UTC; `NOW()` and `UTC_TIMESTAMP()` were confirmed equal.

### Room settings
Composer restores the correct owner's durable Party profile and previous Face title. Cache keys include owner and room kind; server data remains authoritative, editing is protected from late restore responses, and the existing live board remains canonical during auto-resume. Party theme/layout persistence is preserved.

### Usable V6 role frames
V6 art was missing selectable catalog/entitlement integration. Canonical roles, four Host variants and explicit Master decorative grants now flow through authenticated bootstrap, selection, persisted preference, room loadouts and native renderer. Selection invalidates own cache; presence revision includes version/insets. Decorative grants never alter platform permissions. The generic outer profile gradient no longer obscures equipped sculpted art. Master UI is deployed and its actual authenticated grant/revoke form was inspected.

### Gift assets and presentation
Actual source inventory: 156 definitions / 299 media files: 133 MP4, zero GIF, 166 static images (153 WebP, 12 PNG, one JPEG); 129 videos contain audio; zero missing/corrupt source media. Production's 156 mapped entries were retained.

Two independent rendering faults were found: legacy bundled thumbnails took precedence over versioned catalog art, and a local send could be consumed by a realtime event while the gift panel still reserved the foreground. Current catalog thumbnails win; acknowledged sends close the panel before presentation; HTTP/realtime event IDs are deduplicated independently of feed insertion. Lucky results are not coalesced into normal gifts or stripped of their payout fields.

**Additional production root cause:** all 133 installed V6 MP4 entries lacked `videoPresentation=BOUNDED_CINEMATIC`. The yellow-canvas safety guard therefore correctly refused them. The repair verified each stored MIME, byte length and SHA-256 before changing only that presentation field; 133 repaired, financial fields unchanged. Unbounded/legacy footage remains refused; missing/failed effects remain compact. Real MP4 playback on the actual Face screen was recorded after repair. Cold uncached video may still use the existing bounded compact fallback while its cache warms.

### Lucky Gifts
Production had no Lucky entries and no enabled Lucky setting. Three explicit variants now use existing verified source artwork and existing source prices: Heart 500 Coins, Rose 1,500 Coins, Crown of Love 3,000 Coins. Existing normal catalog prices were unchanged. Policy is the existing independent 25% weighted server RNG, 20% recipient / 80% company allocation, 0.1×–25× configured tiers, rare 25×; no ordinary 15% fee is stacked.

Actual panel/recipient/quantity/send path is enabled. Durable result precedes success, panel closes, result uses bounded original Nazraa animation, and the repeat control permits explicit taps only with a 10-second inactivity timeout. An ambiguous acknowledgement retains its original intent for explicit retry. Reference combo count is accepted sends, not a fabricated multiplier.

### Room notices
Routine seat lock/unlock, permission/settings changes and personal/admin mailbox announcements are not injected into ordinary room feeds. Host-local confirmations, actual announcements, gifts, rewards and critical moderation/connection feedback remain.

## Verification and evidence

Evidence directory: `/Users/aishwaryam/nazraa-release-evidence/20261103-completion/`.

- Flutter analyze: no issues. Final focused suite: **49 passed**, one optional export skipped; export separately passed.
- Full suite before the final queue tests: **520 passed, 22 failures, one optional skip**. The failing names exactly match the untouched baseline. No unrelated Home/Profile golden was approved or changed. Only two intentional Princess goldens changed after visual inspection.
- SQL integration: all 16 frame families, selection/restart/cache/unequip/role denial/grant/revoke; normal 85/15 vs Lucky 20/80; eight concurrent same-ID sends yield one transaction; exact IST month boundary; permanent pagination after room end; Pro eight concurrent retries and concurrent worker settlement yield one debit/one settlement.
- Native full app / disposable authenticated local accounts: 23 unique Lucky transactions, 5,750 gross Coins, 1,150 recipient Diamonds, 4,600 company allocation, 300 bonus Coins across four random wins. Includes 20 explicit repeat taps and 12-second idle disappearance; actual recipient API observations retained.
- `princess-native-top3.mp4`: three real QA identities, temporary podium, winning-chair crown/wings, clean next round.
- `pro-bet-round-reset.mp4`: accepted 500-Coin bet remains through reveal/settlement and resets next round; one durable settlement confirmed.
- `lucky-complete-flow.mp4`: real panel/send/result/repeat/timeout, with `logical-recipient-events.json` and `native-financial-summary.json`.
- `face-dynamic-video-verified.mp4`: actual remote gift transaction and native MP4 rendering/disposal on Face. Its background is the emulator's synthetic camera, not a gift fallback canvas.
- `host-frame-live-seat.png`, `frame-selection-before-refinement.mp4`, `room-title-restored.png`: real frame selection/seat rendering and composer restoration. The earlier selection clip predates removal of the outer profile gradient; final source removes it.
- Exact signed artifact installed as versionCode 7426 / versionName 2.5.14. Production Home, Face received video, Party occupied seats/speech indicators/feed and the actual Lucky catalog/prices/terms were inspected. `exact-release-face-viewer.png`, `exact-release-party.png`, `exact-release-lucky-panel.png`, `exact-release-princess-result.png`.
- During the exact-release check, the existing reviewer account recorded nine 100-Coin bet commands in eight Princess rounds, with 540 Coins returned over two winning settlements. These remain legitimate financial ledger entries; no wallet balance, result or refund was manually fabricated. This is separate from isolated deterministic QA.
- `master-role-frame-controls.png` and `public-download-2.5.14.png` are saved from the live website.
- The two temporary local QA rooms were ended via their authenticated `live-end` flow (both HTTP 200), and the QA recipient/round worker loops were stopped.

## Production operation / rollback

A fresh verified offsite backup was required before migration. Additive migration 0114 adds only presentation preference/grant columns. Guarded deployment restarted **only API**; protected configuration digest and 14 other container identities were preserved. LiveKit, Redis, MySQL, reward/economy settings and unrelated VPS apps were not restarted/reconfigured.

Deployment record: `/opt/nazraa/tools/owner-completion-20261103/deployed.json`.
Source rollback archive: `/opt/nazraa/tools/owner-completion-20261103/source-before.tar.gz`.
Rollback image: `nazraa-api:before-owner-completion-20261103`.
Additive columns can remain if the prior API image is restored. Repair/activation operations retain audit records.

Latest app metadata is `2.5.14`, build `7426`, update URL `https://nazralive.in/download`. Existing minimum `2.1.0` and maintenance policy were deliberately preserved. GitHub release is public; APK/AAB/SHA256SUMS assets are present.

## Limits

Physical-device audibility was not verified: the emulator is configured without audio output. Audio tracks and decoder/renderer integration are present; do not claim human listening QA. The 22 baseline Flutter test failures remain. Cold video cache misses can use the existing compact fallback. This release does not claim that unrelated historical defects or every physical network/device combination are eliminated.
