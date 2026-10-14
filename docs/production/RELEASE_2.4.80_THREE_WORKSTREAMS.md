# Nazraa 2.4.80+7392 — three owner-scoped workstreams

Status: **DEPLOYED AND PUBLISHED — 14 October 2026**. All three owner-scoped
workstreams are deployed on the existing VPS. Signed release **2.4.80+7392** is
available from https://nazralive.in/download and the published GitHub release.
The public APK was downloaded and its SHA-256 verified against the exact APK
installed and smoke-tested on Android 16. No second mobile rebuild was required.

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
  retained; live production Face viewer video visibly received; a production
  Party room entered without a user-visible error. Both rooms were left normally.
  The new Party Board History screen loaded the production API, correct targets
  and genuine empty state. Existing Live History loaded actual prior activity
  without an error. These observations are not a physical audio-quality test.
- After deployment, read-only production verification found **2 real Party
  attendance segments**, **1 active**, **40,594 persisted milliseconds** in one
  closed day part, and **0 own-board violations**. These are anonymous aggregate
  observations, not synthetic production activity. Both history query plans used
  `ref` access: `idx_party_board_day_user` and `idx_party_board_user_start`.
- The existing room-maintenance route returned HTTP 200 and `status: complete`.
- Withdrawal authorization, storage, transaction and route integrations passed.
  The expired Master browser session was not used to claim a fresh manual
  finance-button test; no real production balances or Agency assignments were
  changed solely to manufacture a test pass.

Logs: `docs/qa/20261014/three-workstreams/`. Face proof is in a private subfolder;
do not publish that screenshot or any private source/backup archive.

## Published artifacts

- APK: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.80-7392-release.apk`
  - 224,310,925 bytes
  - SHA-256 `44f670dcb7baa887ab4129e7657859019531d047751dfcc4358cf46960210bcb`
- AAB: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.4.80-7392-release.aab`
  - 177,535,737 bytes
  - SHA-256 `5ba979b58ff8289e66762e9a8569107be2700826c833f20d0f68dfa02a88e578`
- Package `com.nazraa.live`; target SDK 36; existing signing unchanged.
- Public download page: https://nazralive.in/download
- GitHub release: https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.80
- Public APK: https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.4.80/Nazraa-Live-2.4.80-7392-release.apk
- GitHub release is published, not draft. GitHub digest and the downloaded public
  binary both match the tested local APK. The signed AAB is retained locally.
- Website version, build, file size, download URL and checksum are updated.
  Public-page proof is `docs/qa/20261014/three-workstreams/public-download-2.4.80-verified.png`.

## Completed safe production deployment

1. Verified existing private OCI predeploy backup
   `production/nazraa-predeploy-20261014T105739Z.sql.gz`: **4,756,562,815 bytes**;
   upload checksum and object head passed. The existing transport encryption and
   OCI at-rest encryption apply; no new client-side encryption is claimed.
   The predeploy snapshot remains excluded from nightly lifecycle deletion.
2. Guarded source staging preserved existing dirty source and owner files in
   `/opt/nazraa/backups/release-2.4.80/`, with previous source, image and metadata.
   Rollback image: `nazraa-api:rollback-before-2.4.80`.
   There was no Git reset or pull over the production working tree.
3. The first MariaDB DDL attempt rejected an indexed generated key concatenating
   raw CHAR UUIDs before creating either new table. The key was corrected to
   `CONCAT(RTRIM(room_id), ':', RTRIM(application_user_id))`, avoiding SQL-mode
   dependent padding. This follows MariaDB's
   [generated-column consistency guidance](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/generated-columns).
   Core integration was rerun successfully after the correction.
4. Migration `0101_party_board_seat_history.sql` is recorded on the production
   MariaDB. No historic attendance was invented. Critical configuration hashes
   were checked unchanged by the guarded migrator.
5. Only the API container was rebuilt/recreated from the existing compose. API
   health is HTTP 200. LiveKit, Redis, database, Caddy, realtime and worker were
   not restarted. The existing worker uses the updated maintenance route.
6. Deployed implementation overlays: `e447a85` (three workstreams), `8492648`
   (MariaDB compatibility), `17a1cce` (public release metadata). Deployment scripts
   and initial evidence were saved in `8614418`; production checkout HEAD remains
   `875d341` with preserved intentional source overlays, not a misleading reset.
7. Production latest version is **2.4.80**; minimum remains **2.1.0** and update
   URL is https://nazralive.in/download. Provider remains **LIVEKIT** and reconnect
   grace remains **300 seconds**. Rewards, gender eligibility, daily cap, Live
   window, wallet economics and media routing are unchanged.

Production build logs are retained privately at
`/opt/nazraa/backups/release-2.4.80/api-build.log` and
`/opt/nazraa/backups/release-2.4.80/public-release-build.log`.
The safe aggregate verifier is `scripts/qa-read-2.4.80-release.cjs`; it prints no
credentials or individual attendance records.

## Owner acceptance status

### Host → Agency

Remove, same-Agency rejoin, different-Agency join, real persistent request,
rejected retry, duplicate pending protection, canonical single membership and
historical preservation: **PASS** in database/repository integration. Misleading
"Request to Master" join feedback is fixed; existing Master Agency-creation
approval remains unchanged.

### Withdrawal Control

Agency expected amount and own scope; Master approve/reject/process/pay;
idempotency; audit; saved USD/hierarchy export and canonical calculator reuse:
**PASS** in the Control integration and role matrix. No new payout formula or
mobile withdrawal change. Unconfigured targets/components are explicitly
unavailable, not guessed.

### Party Board History

Own exclusion, other-board/muted/short-session accumulation, 50-minute daily
target, incomplete-day preservation, independent 24 valid days and 20 hours,
monthly completion, midnight split, backend authority, persistent account-based
history, date list, session drilldown and empty state: **PASS**. Reconnect
duplicates: **NO**. Actual production attendance persistence also observed.

### Regression and limitations

Face viewer and Party entry exact-APK smoke: **PASS**. Party seat lifecycle,
Live History, Gifts/Diamonds and canonical Agency mapping integrations: **PASS**.
Live History UI/calculations were **not modified**; its separate one-line
empty-response correction was explicitly owner-approved. No physical audio
quality measurement or fresh manual Master payout execution is claimed.

Known release blockers: **NONE**. No unrelated business logic, media SDK,
transport, rewards, wallet rule, DNS or infrastructure was changed.
