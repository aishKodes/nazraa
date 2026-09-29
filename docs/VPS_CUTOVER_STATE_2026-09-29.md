# Nazraa VPS cutover state — 2026-09-29

This is an operational checkpoint, **not** evidence that production has moved.
The Vercel API and Hostinger shared database remain the sole live write path;
Oracle LiveKit is unchanged. Do not promote the prepared write-freeze until
authenticated realtime delivery, mobile build, and the off-VPS backup
destination have passed QA.

## Staged VPS

- Hostinger KVM 8, VPS ID `2017514`, Mumbai 2, IP `187.126.115.185`.
- Ubuntu 26.04; private MariaDB 11.8.9 container `nazraa-mariadb-staging`,
  private Redis 7, API and realtime containers.
- Root-only runtime secrets: `/opt/nazraa/config/app.env`; separate read-only
  source credentials: `/opt/nazraa/config/source-db.env`. Never print either.
- The historical `DOCUMENT_ENCRYPTION_KEY` was imported without mutation and
  verified against an existing encrypted record without displaying content.
- The first empty MySQL 8 container is **not** the production candidate. Never
  start it or Compose MariaDB against the staging MariaDB data directory.
- The temporary SSH/443 `/32` allowance was removed after the connection test.
  The Mac completed TCP establishment but never acknowledged the VPS SSH
  banner; this is a return-path connectivity issue, not failed SSH credentials.
  Continue through Hostinger's authenticated web terminal until resolved.

## Database evidence

- Online read-only snapshot: `/opt/nazraa/backups/source-fresh-20260929.sql.gz`
  (SHA-256 `1bd1381d9f938a821d93076c1f984ea9f111ca21dfadfd97c93c77e963d55db5`).
- Imported separately as `nazraa_fresh` within staging MariaDB.
- A guarded final-import script now requires explicit confirmation of the
  source write freeze, a SHA-256 match, a valid gzip dump, and a **new empty**
  `nazraa_final_YYYYMMDD_HHMMSS` schema. It does not change the application
  database pointer or enable writes; those require subsequent reconciliation.
- Preliminary comparison found 123 tables and 93 migrations on both sides,
  exact table counts, wallet and ledger aggregates, and ordered row hashes for
  22 critical financial tables. Logs are in `/opt/nazraa/backups/`.
- This is **not the final cutover dump**. Repeat after fencing all Vercel and
  shared-DB writers and draining in-flight operations. Reconciliation must be
  green before reopening mutations on the VPS.

## Realtime and TLS

- Branch `migration/hostinger-vps-2026-09-28` contains authenticated read-only
  room WebSocket subscriptions, Redis invalidation publication after room
  mutations, and an Android client that falls back to HTTP if realtime fails.
- Build the mobile release with `NAZRAA_API_BASE_URL=https://api.nazraa.pixtra.site`
  and `NAZRAA_REALTIME_URL=wss://ws.nazraa.pixtra.site/realtime` **only after**
  the domains and TLS are verified. Existing APKs still call Vercel.
- The new `api.nazraa.pixtra.site` and `ws.nazraa.pixtra.site` A records both
  resolve to `187.126.115.185`; unrelated DNS remains untouched. Caddy
  obtained valid Let's Encrypt certificates for both names on 2026-09-29.
- `nazraa-caddy-qa` runs only the restricted `Caddyfile.qa`, allowing the
  approved `203.110.247.52/32` QA client. QA API and WebSocket health returned
  HTTP 200 with valid TLS; a non-QA source on the VPS received HTTP 404 for
  both. The internal authorization route returned 404 at the public edge.
  An unauthenticated WSS upgrade returned 401; a valid-format but unauthorized
  room subscription closed with 1008.
- The first manually launched WebSocket container lacked a resolvable API
  origin. It was stopped and replaced by `nazraa-realtime-qa2` with an explicit
  `REALTIME_API_ORIGIN`; its internal authorization link returns 403 for an
  invalid token. A synthetic staging-only account/room then authenticated
  through the public QA WSS edge: the client received `ROOM_READY`, and a
  Redis room invalidation arrived as `ROOM_CHANGED` (`seat`). The synthetic
  room, session, and account were deleted afterward; follow-up counts for all
  three were zero. This proves the QA transport path, not production traffic
  or mobile end-to-end behavior.
- The patched/pruned `nazraa-api:secure-pruned` image built on the VPS with
  Next.js 16.3.6 and Sharp 0.35.5. Local build/integration checks passed and
  the production dependency audit found no known advisories. The QA API target
  `nazraa-api-candidate` now runs this image against the staging database;
  the previous candidate is stopped as `nazraa-api-prepatch` for rollback.
  Vercel remains production.
- A 30-sample warm request from the India QA client to the public config route
  measured Vercel p50/p95 65.0/74.2 ms and QA VPS 69.0/72.5 ms. This route
  may be cached and is **not** a hot room or financial path speed comparison.

## Required cutover order

1. Validate new A records and HTTPS without changing current production DNS.
2. Complete authenticated API auth/schema parity and exact mobile artifact QA;
   the public QA WebSocket event path has passed with a synthetic room.
3. Establish encrypted off-VPS backup destination and restore check.
4. Prepare signed mobile APK/AAB, but do not publish them yet.
5. Fence old workers and API writes; drain in-flight financial operations.
6. Export/import final fresh DB; run `npm run migration:compare-db` in final
   frozen mode and investigate any mismatch.
7. Bring up one VPS scheduler/worker, switch API/WS traffic, smoke-test, then
   reopen writes. Keep the old DB frozen. Never write to both databases.
8. Publish the tested mobile artifact, update download/GitHub/version metadata,
   monitor, then clean temporary migration artifacts.

Rollback after new writes begin must retain the **new authoritative database**;
do not point an old API at the stale shared database and lose transactions.
