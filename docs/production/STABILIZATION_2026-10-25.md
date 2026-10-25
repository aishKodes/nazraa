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

Total removed: 106,821,830,882 bytes. After API build and cleanup: 220 GiB used, 168 GiB free, 57%; inodes 4%. Exact filenames/checksum manifests remain in `/opt/nazraa/logs/stabilization-20261025-approved-local-duplicate-removal.json` and `nightly-retention.jsonl`.

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

- Flutter analyze: no issues; all 479 Flutter tests pass, plus 24 focused lifecycle tests.
- Full backend core-mobile regression passes, including rewards, 30-round shared games, Gifts, membership, seats and media authority.
- Focused stabilization integration: present Host, uncertain SFU, three fresh-evidence races, returning Host refresh, confirmed absent cleanup, idempotency, explicit close; offline ACTIVE Agency owner, six concurrent join retries, owner acceptance/mapping, unavailable/suspended/banned/inactive and removed cases.
- Role matrix and TypeScript checks pass.
- Retention tests verify actual 2026 ISO-week boundaries, protected snapshots and opt-in behavior.

## Release gate

Current public artifact was independently verified as **2.5.02+7414**, SHA-256 `28d3fdebf4d616f318d236e6693885cc3bae1c55bd8357eb30e71187fccad07a`; the owner's older 2.4.93 baseline is no longer current. This exact public APK was installed over the test build without uninstalling; the existing profile/session/wallet view remained available.

Face/Party runtime and final candidate checks are still in progress. Do not treat automated tests or container health as their runtime PASS. No new public APK, public release metadata or minimum version has been changed yet. Do not publish until the remaining gates pass; keep the minimum unchanged until real-user verification.
