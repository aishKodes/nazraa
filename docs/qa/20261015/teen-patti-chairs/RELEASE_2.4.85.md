# Verified release — 2.4.85+7397

## Completed

New-game presentation renamed Teen Patti Princess, with cleaner single-title panel, original chip flights/piles, deal/reveal/payout motion and bounded result celebration. Existing Pro files remain byte-for-byte unchanged (widget SHA-256 `cbc091c64daecfa1bd86ece23ac79f729c63878354f623150c054503f56c0135`; evaluator `7062a001104667ecec248ce45eb0b62ba5a726fb08e99bbc17ef001b0173a054`). No payout, odds, card-comparison, reward or media rule change.

Master removal is an explicit action on Host detail. Both relationship mappings and membership history update atomically; audit and mobile notice persist. Same/different Agency reapplication, duplicate removal and pending submission retries, all-role denial and stale form guards passed isolated database tests. Mobile refresh on Agency entry/resume/manual action removes the need for reinstall/relogin. No real Host was removed for testing.

## Validation

- Flutter analyze: no issues. **300 Flutter tests passed**, including chip motion/pile lifetime, 20 rapid taps, lost-ack retry, stale-round failure, three widths at 130% text, 30 UI rounds, existing media/game tests and prior non-game goldens.
- Isolated MySQL core suite passed, including new-game 30-round settlement, exact fee, current membership bootstrap and Master reapplication lifecycle. Control integration: 30 groups / eight roles passed. Role matrix and exhaustive new-game hand/deal tests pass; Next production build and final typecheck pass.
- Exact signed APK installed on Android 16; package `com.nazraa.live`, versionCode 7397, targetSdk 36, minimum 24. Existing ordinary-account session retained.
- Read-only exact-APK 50-second production video covers consecutive live betting/locked/reveal/result/next-round states and changed server hands. New card reveal/order and next-round clearing observed without overflow or fatal errors. Pro opened and retains original blue three-lane/Crown presentation and server countdown.
- Chip placement/payout financial assertions and real-pile motion use isolated fixtures. No production wager or manufactured win was used to claim a pass. This is not new physical-device multiplayer or capacity certification.
- Master Control's browser session had expired to login. Actual membership mutations were validated in isolated role/database tests, not by removing a real production Host.

## Artifacts

APK `Nazraa-Live-2.4.85-7397-release.apk`: 225,230,738 bytes; SHA-256 `57198caf3f6ebecf1d3f279aa600a1df092fac8d8074fc60976cfde014116063`.

AAB `Nazraa-Live-2.4.85-7397-release.aab`: 178,362,530 bytes; SHA-256 `3cfcda049ed1f8be40f3483f291ea4ee0d552c57f773b36ad9a444d94fe78ab4`.

APK/AAB compiled arm64 application library both SHA-256 `587fc16e34e03622767a54f505086061aed62cd61b03ac74f5a3a8c3f6642ab8`. Existing signer SHA-256 unchanged: `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.

Signed artifacts are in `/Users/aishwaryam/nazra2/dist/`. Sanitized mobile source archive and incidental account runtime proof remain in local private QA storage, excluded from Git.

## Production / rollback

Reviewed additive commit `202fe44` applied to the existing VPS working source after fresh encrypted offsite-backup verification. No Git reset/pull or migration. Full working-source snapshot, applied patch, verified backup record and previous API image protected under `/opt/nazraa/backups/release-2.4.85`; rollback image `nazraa-api:rollback-before-2.4.85`.

Fresh encrypted offsite backup verified: `nazraa-nightly-20261015T114600Z`, 4,893,027,006 bytes. Final service health: API/realtime/MySQL/Redis healthy; worker and Caddy retain their previous uptime.

Only API container replaced and health verified. MySQL, Redis, realtime, worker and OCI LiveKit not restarted. Production new-game and Agency functionality use the existing authoritative database; no economy/media configuration mutation.

GitHub `aishKodes/Nazraa-Releases` v2.4.85 is public; asset digests match local files. Public APK downloaded completely on VPS and SHA-256 checked before switching the site. `https://nazralive.in/download` and `/release/latest` visibly show 2.4.85 / 7397, correct URL and hash.

Audited remote release helper updated only latestVersion / updateUrl: latest 2.4.85, minimum 2.1.0 unchanged; maintenance unchanged; protected media/economy/Live/game settings digest unchanged. Public proof: `public-download-2.4.85.png`.
