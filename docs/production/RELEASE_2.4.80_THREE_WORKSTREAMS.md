# Nazraa 2.4.80+7392 — three owner-scoped workstreams

Status: implementation and automated release gates PASS; VPS deployment and
public distribution NOT yet completed. The Mac locked during authenticated
Hostinger web-console access. Direct key-only SSH still times out during banner
exchange. No public update pointer was changed and the GitHub artifact is DRAFT.

## Scope and root causes

- Agency apply returned historical REMOVED/REJECTED requests; Flutter also
  treated historical approval as current membership. Current mapping is now
  canonical, terminal requests can be retried with a new durable ID, existing
  pending requests are reused, one simultaneous application remains enforced.
  Master and Agency removal preserve Host account and old membership history.
- Withdrawal Control uses the existing configured whole-Host slab calculator
  and immutable paid USD/hierarchy snapshots. Master-only mutation is enforced
  in the repository, not only the buttons; retries do not create another
  payment, commission, release or audit. Existing mobile cash-out remains off.
  Unconfigured Agency targets explicitly remain unavailable.
- Party Board History is additive. Two minimum durable tables capture eligible
  Host seat segments and millisecond-accurate business-date attribution. Own
  boards are excluded; mute does not create boundaries. Seat leave/kick/room
  end and authoritative absence close time durably. Short reconnect preserves
  the seat identity and active segment. Existing 60-second maintenance is
  reused; there is no new history polling or client accounting stopwatch.
- Separately owner-approved one-line Live History empty-response correction:
  empty mysql2 result tuples now unwrap to actual empty arrays. No Face history
  UI, reward calculation or existing Live accounting was changed.

## Evidence completed

- Backend implementation commit: `e447a85` on
  `fix/owner-two-track-20261012`; pushed to existing repository.
- Rollback source branch: `rollback/2.4.79-before-agency-withdrawal-board-history`.
- Flutter analyze: no issues. Complete Flutter suite: **266 PASS**.
- New Party history widgets: 320/390 widths, genuine server summary,
  day drilldown, no background polling, safe retry and historical membership
  regression covered. Existing visual goldens pass without replacement.
- TypeScript typecheck and Next production build PASS.
- Control integration: **30 groups / 8 roles PASS**, including rejection,
  repeated approve/process/pay, single final ledger entry, four actual audit
  transitions, own-Agency finance scope and canonical USD/export source.
- Core database integration PASS: Agency A removal/rejoin and approval,
  remove then B application/approval, rejected retry, concurrent duplicate
  requests, canonical bootstrap and old roster/history preservation.
- Party Board integration PASS: own exclusion, 2+8+10, 25+25, 35/50/70 minutes,
  muted time, repeat assignment/leave, stable seat reconnect identity, signed
  LEFT + stale-presence timeout, JOINED protection, retry-safe worker,
  actual persisted midnight split, 24-day/20-hour independent requirements,
  month rollover, date/session details and unchanged Live History.
- Role matrix PASS; PK streak policy 9 cases PASS; game RTP model PASS.
- Signed exact APK installed on `emulator-5554`, API 36. Existing login and Home
  retained; live production Face viewer video visibly received. This is not a
  claim of physical audio-quality or new server-ledger UI validation.

Logs: `docs/qa/20261014/three-workstreams/`. Face proof is in a private subfolder;
do not publish that screenshot or any private source/backup archive.

## Artifacts built, not distributed

- APK: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.80-7392-release.apk`
  - 224,310,925 bytes
  - SHA-256 `44f670dcb7baa887ab4129e7657859019531d047751dfcc4358cf46960210bcb`
- AAB: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.80-7392-release.aab`
  - 177,535,737 bytes
  - SHA-256 `5ba979b58ff8289e66762e9a8569107be2700826c833f20d0f68dfa02a88e578`
- Package `com.nazraa.live`; target SDK 36; existing signing unchanged.
- GitHub `aishKodes/Nazraa-Releases`, `v2.4.80`: DRAFT with APK uploaded;
  GitHub SHA digest equals local artifact. Do NOT publish before VPS gates.

## Remaining deployment sequence

1. Unlock Mac; reopen the existing Hostinger console. Current root shell URL
   observed `https://mum2.hostingervps.com/2843/`, checkout `/opt/nazraa/app-next`.
2. Read `/opt/nazraa/backups/three-workstreams-qa/predeploy.log`. The approved
   existing offsite backup was started in the background via
   `scripts/qa-three-workstreams-predeploy-backup.py`; verify
   `PREDEPLOY_BACKUP_VERIFIED` before applying anything. Do not start two dumps.
3. Run `qa-stage-three-workstreams.py`. It guards HEAD `875d341`, old release
   2.4.79, verified backup, patch SHA, and non-overwrite rollback directory.
   It preserves full existing source/owner edits and tags current API image
   `nazraa-api:rollback-before-2.4.80`. No reset/pull-over-dirty-tree.
4. Copy only migration 0101 into current API container `/tmp/nazraa-0101-party-board.sql`;
   run `qa-migrate-party-board-history.cjs` there. It validates schema 0100,
   uses MariaDB local server secrets internally, verifies critical config
   hashes unchanged and records migration 0101. No historic attendance invented.
5. Build/start only the API service from existing compose; do not restart
   LiveKit, Redis, database, Caddy, realtime or worker. Verify health/cron;
   current worker calls the updated existing maintenance route.
6. Smoke exact APK against updated Party Board History, real empty Live History
   and Agency UI; verify ledger persistence and terminal handling, without
   altering real financial balances or membership.
7. Publish draft APK; update tested public release metadata to version/build,
   exact path, size and checksum above; deploy site metadata; run guarded
   `qa-publish-2.4.80-mobile-version.cjs`. Keep minimum/media/economy rules.
8. Verify public download and GitHub hash, record page screenshot, update this
   report with actual deployed status. No new mobile rebuild is necessary.

No unrelated media SDK, transport, rewards, wallet rules, DNS or infrastructure
was changed by this implementation. Production currently remains 2.4.79 until
the above migration and exact-release server checks have passed.
