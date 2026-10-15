# TeenPatti addition — 2.4.84+7396

## Scope and rules

New ID `teen_patti`, separate from `teen_patti_pro`. The existing Pro widget and evaluator are byte-for-byte identical to the archived 2.4.83 source (SHA-256 `cbc091c64daecfa1bd86ece23ac79f729c63878354f623150c054503f56c0135` and `7062a001104667ecec248ce45eb0b62ba5a726fb08e99bbc17ef001b0173a054`). Pro paytable/Crown/history remain separate.

The new game uses an unbiased single 52-card deck, three cards per Green/Blue/Red Chair, exact 3× gross winning return and exactly 3% of gross as its fee. No inherited Pro RTP scaling or two-lane restriction. The owner delegated unspecified comparisons: AKQ > A23 > KQJ … >432, KA2 invalid; Pair rank precedes kicker. See `IMPLEMENTATION.md` for full reference and original-art provenance.

## Verification

- Flutter analyze clean; full **299 tests passed**, including the new-only visual golden and ten new widget tests. No existing Pro/Home/Profile golden was updated.
- Exhaustive 22,100-hand evaluation; 5,000 unbiased deals with nine unique cards, exact strongest winner, hierarchy/points/suit cases, exact video payout and fee without net profit.
- Isolated MySQL core suite passed: preview secrecy; three-chair bets; debit, fixed payout/fee, history, retry/mismatched-ID protection; 30 new-game rounds and existing game regressions. Pausing new TeenPatti does not abort Pro maintenance.
- Control integration: 30 groups / eight roles passed. Existing RTP suite passed unchanged. Authenticated local Redis/WebSocket transport passed for both rooms and the separate new-game channel.
- Exact signed APK installed on Android 16, package `com.nazraa.live`, versionCode 7396 / targetSdk 36. Existing ordinary-account session retained.
- Production new-game API and worker/Redis/WebSocket phase state observed. Exact-APK 50-second recording covers complete betting/lock/reveal/result/next-round sequences, distinct server hands, correct winning highlights and cleared next-round cards. History shows real descending completed round IDs and their actual winning cards. Card-back paint is clipped; no overflow was seen.
- Runtime QA is read-only: no production wagers/balance changes were manufactured to create a win. Financial/payout and rapid 20-tap/lost-response/stale-round race checks ran in isolated fixtures. This is not a new physical-device multi-player wagering or capacity certification.
- No LiveKit/native media/seat/audio lifecycle changes. Existing media/effect/room regression tests passed; live services and economy/reward configuration were preserved.

## Deployment / rollback

Source commits `a74d88e` + `cfa6b07` staged additively on the existing production working tree, not reset/pulled. No migration required. Only API and game realtime containers replaced; no MySQL/Redis/LiveKit restart.

Fresh encrypted offsite backup checksum verified: `nazraa-nightly-20261015T103926Z`, 4,884,167,256 bytes. `/opt/nazraa/backups/release-2.4.84` protects complete working-source overlays (including untracked source) and prior API/realtime image IDs; rollback tags `nazraa-api:rollback-before-2.4.84`, `nazraa-realtime:rollback-before-2.4.84`.

## Signed artifacts

APK: `Nazraa-Live-2.4.84-7396-release.apk`, 225,197,862 bytes.
SHA-256: `6914ae1f1523c1aa96a0219543b9c83f9337f183fc7833eccc78ed7c6f61ca34`.

AAB: `Nazraa-Live-2.4.84-7396-release.aab`, 178,289,474 bytes.
SHA-256: `a21f545e26102b7a6b33c7bb212d93e14425c0d707a34409d9fb65af302b5d7b`.

Both contain the same compiled application library. Existing Android signing certificate SHA-256 remains `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.

## Public release verification

`https://nazralive.in/download` and `/release/latest` now show **2.4.84 / 7396**, the versioned GitHub APK URL and SHA-256 above. The public APK was downloaded completely on the VPS and its SHA-256 verified before changing the download page. GitHub Release `aishKodes/Nazraa-Releases` / `v2.4.84` is public (not draft); GitHub asset digests match both signed files.

Audited SYSTEM maintenance updated only remote `latestVersion` / `updateUrl`. Result: latest 2.4.84, minimum 2.1.0, minimum preserved, maintenance preserved, protected media/economy/Live rules/other-game settings digest unchanged. No forced-upgrade threshold changed.

The final API and realtime services are healthy. Pro was additionally opened in the exact APK and displayed its original three lanes, Crown and server countdown. No production wagering was used for QA. The public download screenshot is `public-download-2.4.84.png`; incidental account data and runtime recordings remain in private local QA storage. Sanitized Flutter source and signed APK/AAB are archived locally.
