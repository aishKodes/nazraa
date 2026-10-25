# Production stabilization — 25 October 2026

## Implemented backend changes

Deployment commit `9510592139e03d8e776ba51e8352f8b60d5cda14` passed source SHA guards, API health and public config checks. Only the API was recreated. System settings and all 111 migration records remained identical. OCI media, MySQL, Redis, workers, realtime and unrelated VPS apps were not restarted.

### Face room finalization

Two concrete defects were reproduced in the existing stale-room path:

1. `finalizeStaleLiveSession` selected a stale Host outside its finalization transaction. A new membership/media heartbeat could arrive before `finalizeLiveSession` acquired its locks; the finalizer then ended that recovered room without checking freshness again.
2. `refreshRoomPresence` ran stale cleanup before refreshing an authenticated returning Host's own checkpoint.

The normal Host refresh no longer invokes stale cleanup. Discovery/maintenance check LiveKit Host presence only for stale candidates, outside DB locks, with a three-second RPC bound. PRESENT or UNKNOWN defers cleanup. A confirmed absent Host must still satisfy membership, media heartbeat and signed-media evidence freshness checks under the room lock. The existing 300-second stale grace was not increased. A present Host with a failed camera remains recoverable. This does not add reward-eligible time.

Finalization records `HOST_EXPLICIT_LEAVE`, `SCHEDULE_CLOSED` or `STALE_HOST_CONFIRMED_ABSENT` in the existing durable close-attempt table. No new diagnostics table or timer was added. Explicit close, moderation and the configured Face schedule remain authoritative. Existing Flutter generation guards, component watchdog, Beauty fallback, Auto Resume and nonterminal reconnect behavior remain intact.

The lack of historical server-finalizer reasons means the old incident count cannot all be attributed to this race. The two defects above are demonstrated by deterministic tests; the new reason records make future incidents distinguishable.

### Agency join

Owner resolution used UUID/external/public IDs but reported a missing reference as an “active owner” problem. Search considered any resolved owner joinable, even a banned owner. Control accepted arbitrary owner-ID text, allowing more broken references.

Search and apply now share account-status eligibility, trim legacy references and exclude removed Agencies. An offline ACTIVE account is eligible; suspended/banned/inactive or unresolved owners return their accurate status. Supplied owner IDs in Control must resolve uniquely to an ACTIVE user and are stored as the canonical UUID. Agency membership, commissions and approval rules are unchanged.

Production initially contained 222 ACTIVE Agencies with ACTIVE owners, eight unresolved ACTIVE owner references and one ACTIVE Agency with a banned owner. Five exact reviewed email/User-ID matches were approved by the owner and repaired atomically with audit records. Running the repair again changed zero records. No wallets or Agency memberships were modified.

Remaining legacy cases require care:

- 178915: created directly in Control by Admin; no creation application or confirmed owner reference.
- 784850: created directly in Control by Country Manager on 24 October; no creation application or owner reference.
- 962212: the matching original approved application belongs to ACTIVE Agency 960815, correctly owned by User 12000084. Do not assign that user a second Agency automatically.

These are accurately unavailable, rather than bypassing ownership checks. The first two still need the intended owner User IDs.

## VPS storage audit and approved cleanup

Root filesystem: 387 GiB. Before: 319 GiB used, 69 GiB free, 83%; inodes 4%. Largest consumers: `/opt/nazraa/backups` 217 GiB (production subfolder 204 GiB), MariaDB directory 22 GiB and Docker (31.12 GB images, 59.08 GB build cache). Journald was only 62.1 MB; active container logs were small. Backups, not logs, dominated growth.

The latest 24 October backup passed `gzip -t` and its SHA-256 manifest. The successful nightly service log confirmed OCI upload/checksum verification. Every removal candidate's OCI object size and checksum-manifest existence was rechecked before deletion.

Owner-approved removals:

- Nine same-day duplicate nightlies: 44,402,678,177 bytes. Dates: one 14 October, seven 15 October, one 17 October.
- Fifteen redundant older nightlies: 62,419,152,705 bytes. Dates: 1–3, 5–10 and 12–17 October. The 4/11 October weekly copies and 18–24 October dailies remain.

Total removed: 106,821,830,882 bytes. Immediately after cleanup: 220 GiB used, 168 GiB free, 57%; inodes 4%. After retaining the final API and rollback builds: **222 GiB used, 166 GiB free, 58%; inodes 4%**. Exact filenames/checksum manifests remain in `/opt/nazraa/logs/stabilization-20261025-approved-local-duplicate-removal.json` and `nightly-retention.jsonl`.

All predeploy/recovery/September cutover files, current/rollback images, active volumes, DB files, Redis, user media, secrets and certificates remain. Docker caches and unrelated apps were not pruned. Production data tables, including room-photo assets (~4.1 GB) and private documents (~1.17 GB), were measured and preserved.

## Retention and operational checks

Owner approved seven daily plus four weekly local nightly representatives; overlapping daily/weekly copies are retained once. All predeploy/recovery/September cutover snapshots are excluded. The existing nightly backup service invokes retention only after immutable offsite upload verification. A metadata/checksum error preserves local candidates. The current backup's checksum is checked again before pruning. No OCI objects are deleted by this script; the existing separate OCI lifecycle stays unchanged.

Nazraa Compose now caps each service's JSON logs at 3 × 20 MB. This is active on the recreated API; other services receive it at their next normal recreation, without an unnecessary database/realtime restart. Current journal/container logs did not require deletion.

No existing disk-alert integration was found. Operator check procedure:

```sh
df -h /
df -i /
docker system df
du -xhd1 /opt/nazraa/backups
systemctl status nazraa-backup.service --no-pager
docker stats --no-stream
docker exec nazraa-redis-1 redis-cli INFO persistence
```

Review disk and inode usage at 70% informational, 80% warning, 90% critical. Investigate growth before further cleanup. Review preserved predeploy backups separately; never apply a blanket volume/image/data prune. At audit time, RAM had ~16 GiB available, no swap, load ~1.5, disk I/O wait 0%; MySQL had zero matching disk-full/corruption errors in the prior 24 hours and Redis reported successful persistence writes.

## Verified automated tests

- Flutter analyze: no issues; all **481 Flutter tests** pass, including the two new close-context tests. The earlier 24 focused lifecycle tests also passed.
- Full backend core-mobile regression passes, including rewards, 30-round shared games, Gifts, membership, seats and media authority.
- Focused stabilization integration: present Host, uncertain SFU, three fresh-evidence races, returning Host refresh, confirmed absent cleanup, idempotency, explicit close; offline ACTIVE Agency owner, six concurrent join retries, owner acceptance/mapping, unavailable/suspended/banned/inactive and removed cases.
- Role matrix and TypeScript checks pass.
- Retention tests verify actual 2026 ISO-week boundaries, protected snapshots and opt-in behavior.

## Production close diagnostics

Commit `8347b355f991cb9e3e971b0670aa5b501ea69f30` added bounded optional context to the existing close-attempt route and existing audit table. No migration. New clients report version, cached camera/Beauty state, LiveKit state, whitelisted network/ICE state and reconnect attempts. Room/session references in the structured context are hashed. No IP, SSID, media, chat, token or arbitrary SDK payload is accepted. Server-only finalizations retain unknown client facts explicitly rather than inventing them.

The client reads existing cached state; it does not start an API request, stats sampler, timer or media operation to collect this context. Older clients remain compatible. Diagnostics are not reward or authorization evidence and cannot terminate a room. The full core-mobile regression was rerun after these changes; strict-field validation, old-client compatibility, nonterminal logging and idempotent canonical finalization passed.

This second guarded deployment recreated only the API and verified settings/schema remained unchanged. Its source backup is `/opt/nazraa/backups/stabilization-close-context-20261025.tar.gz`; rollback tag is `nazraa-api:before-close-context-20261025`.

## Exact artifact runtime and public release

The preceding public artifact was independently verified as **2.5.02+7414**, SHA-256 `28d3fdebf4d616f318d236e6693885cc3bae1c55bd8357eb30e71187fccad07a`; the owner's older 2.4.93 baseline was no longer current. It was installed without uninstalling and tested before the new release. Its Face session remained usable for 14m10 eligible publishing time, including camera switch, mic changes, brief offline/constrained network and background recovery. Its Party smoke covered seats, lock/unlock, mic, chat, Gifts, Games and settings.

Final public version: **2.5.06+7418**, Flutter commit `13cda67594d0083a66dc5d28b207cbfa18634c34`, branch `release/2.5.06-7418-stabilization`. Package `com.nazraa.live`, min SDK 24, target/compile SDK 36, release mode. The existing Flutter/LiveKit/WebRTC dependencies remain unchanged. The isolated SDK-upgrade experiment was not merged. `NAZRAA_FACE_HD_FIRST_TEST=false`; no developer media-diagnostics UI flag was supplied.

The final APK was installed over the prior candidate without uninstalling. Existing Host authentication, profile, balances, saved Party cover/title and Beauty controls were preserved. Face started with zero viewers. Production SFU inspection confirmed unmuted camera/mic and the 1280×720 rotated HIGH publication metadata; the durable ledger was PUBLISHING and accumulated time. Beauty, a 12-second emulator offline interval and background/resume were exercised. The room remained usable and ended only on explicit Host close. Final Face ledger: FINALIZED, 295 valid publishing seconds. The production client-close audit received this exact build's context: connected, Wi-Fi, ICE connected, camera on and Beauty enabled. The server recorded one canonical explicit Host finalization.

Final Party smoke: actual seat join, mute/unmute round-trip, Gift catalogue, Game Center and settings/theme entry. The SFU retained audio publication while Games was open; no video track was present. Explicit close returned Home. Final Party ledger: FINALIZED, 192 valid publishing seconds. Both QA rooms ended and **zero QA SFU rooms** remained.

Actual production Agency E2E used the existing QA Agency and normal authenticated APIs: temporarily remove its own existing QA member, six concurrent applications -> one pending request, owner sees it, accepts twice safely, authoritative membership refreshes. Original QA Agency association was restored; both temporary API sessions were revoked. The five repaired Agencies and the original approved Agency 960815 were available in search; unresolved/duplicate legacy records were accurately unavailable. No financial operation, role override or ordinary-user membership was used to manufacture a test result.

These are Android 16 emulator/synthetic-camera checks. No physical phone was available; this is not a claim of real Wi-Fi/mobile-network or optical Beauty certification. Real users should verify the update before minimum-version enforcement.

### Published artifacts

- APK: `https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.06/Nazraa-Live-2.5.06-7418-release.apk`
- APK bytes: 259,196,682
- APK SHA-256: `210f876cb28313266aa314c190adff3eb566881f1f2cc9c3c55f4b5c2b9510bf`
- AAB SHA-256: `9a5aae3247c2c963369f9912e95650a79c67c8063695a2d374527b4f5c36eb11`
- Permanent signing certificate SHA-256: `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`
- Local artifacts: `/Users/aishwaryam/nazra2/dist/stabilization-2.5.06/`

The exact tested APK/AAB and SHA256SUMS are public under GitHub release `v2.5.06`; GitHub's asset digests match. The APK was downloaded fully from the public URL, matched byte-for-byte, installed without uninstalling and opened Home with the existing account/balances intact. The early pre-telemetry candidate is archived internally and was **not published**.

`https://nazralive.in/download` and `/release/latest` return 2.5.06, build 7418, the matching URL/size/hash. Publication commit `56b4fa637bb8e79af7f72a19d28f4c440ee2e64b` changed only canonical website release metadata; its API-only deployment retained rollback image `nazraa-api:before-public-2.5.06` and previous source under `/opt/nazraa/backups/release-2.5.06-7418/`. Existing GitHub release history remains.

Only after public verification, `mobile.app_config.latestVersion` was updated to **2.5.06** with a SYSTEM audit. **minimumVersion remains 2.1.0** and update URL remains `https://nazralive.in/download`; the script verified every other mobile-config field was identical. Public config was read back. No forced update. Reward currency/amount/rules, media routing, schema and all other settings were preserved.

Final health: API, MySQL, Redis and realtime healthy; worker/Caddy running. MySQL/Redis/realtime/worker uptime remained seven days, demonstrating they were not restarted by these deployments. No production DB/media volume was deleted or migrated.

### Follow-up requiring owner data

Provide the intended owner User IDs for legacy Agencies 178915 and 784850. No source record supports guessing those assignments. Agency 962212 remains a legacy duplicate; its approved application is already represented by correctly owned Agency 960815. These cases are unavailable rather than assigned to the wrong person. Minimum-version enforcement awaits real-user rollout verification.
