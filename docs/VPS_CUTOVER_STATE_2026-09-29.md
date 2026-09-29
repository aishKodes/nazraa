# Nazraa VPS cutover state — 2026-09-29

This is an operational checkpoint, **not** evidence that production has moved.
The Vercel API and Hostinger shared database remain the sole live write path;
Oracle LiveKit is unchanged. Do not promote the prepared write-freeze until
the signed mobile artifact, final writer fence, final import, and financial
reconciliation have passed QA.

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
- The manually started QA API still emits 14 Vercel asset origins in its
  public config because it did not set `NAZRAA_PUBLIC_API_ORIGIN`. The final
  Compose API now pins the new HTTPS API origin; verify this in a fresh
  candidate container before traffic switch. The current QA response is not
  evidence that post-cutover asset links are ready.
  An existing public banner asset returned HTTP 200 and exactly 69,526 bytes
  through both Vercel and the QA VPS asset endpoint; SHA-256 matched
  (`7e1338050f49239888e8738be6e9650c16ff63a87150d566129092b661f86bdb`).
  This proves one asset route, not all uploaded media.
- The current compressed staging snapshot is 2.8 GiB. VPS disk usage is
  23/387 GiB; staging MariaDB uses about 2.3 GiB of 31.3 GiB RAM at idle.
  This is capacity context, not production load evidence.
- The owner approved a private OCI Mumbai backup destination. Bucket
  `nazraa-prod-backups-mumbai-20260929` is Private/Standard with Oracle-managed
  encryption. Service identity `nazraa-backup-vps` has API-key access only,
  scoped by policy to reading the bucket and creating/inspecting/reading its
  objects; it has no object delete or overwrite grant. The signing private key
  and CLI config remain root-only on the VPS under `/opt/nazraa/config/oci/`.
  Never copy either into Git or diagnostic output.
- The 2.8 GiB read-only source snapshot was uploaded to this bucket as
  `staging/source-fresh-20260929.sql.gz`, downloaded again, and verified against
  SHA-256 `1bd1381d9f938a821d93076c1f984ea9f111ca21dfadfd97c93c77e963d55db5`.
  The downloaded object passed gzip validation and imported successfully into
  a new isolated `nazraa_restorecheck_20260929_121500` schema with 123 tables.
  No application database pointer changed. This verifies the offsite path,
  **not** the final post-freeze production backup.
- OCI multipart creation requires `OBJECT_OVERWRITE` even for a new object.
  The guarded `deploy/vps/backup-to-oci.sh` therefore uses immutable
  single-part PUTs with `--no-overwrite` to preserve the narrower credential.
  It is prepared but **not installed or scheduled** until the final database is
  authoritative. `deploy/vps/verify-oci-restore.sh` is also prepared for a
  checksum-checked isolated restore. Run both against a new final schema after
  cutover and only then schedule nightly backups.
- Local branch checks on 2026-09-29: `test:core-mobile`, `test:roles`,
  `test:vps-origin`, `test:integration`, and TypeScript typecheck passed.
  ESLint reported no errors (two existing image-optimization warnings).
  The standalone
  `test:realtime-publisher` requires `REDIS_URL` on the private VPS network
  and failed locally because that environment was not supplied; the actual
  private Redis to public QA WSS delivery path passed as described above.
- A separate short-lived staging account reached the QA HTTPS API. Auth,
  profile, rooms, and verification-status reads returned 200 with expected
  response keys; an unauthenticated auth request returned 401. The staging
  account/session were removed and both remaining counts were zero. The first
  auth request took 687 ms; later profile/rooms/face reads took 188/73/68 ms
  respectively. This is not a statistically valid p95 latency benchmark.
- An Android 16 emulator booted and launched an isolated `.mediaqa` debug APK
  compiled with the QA API/WSS endpoints. The Nazraa sign-in screen appeared
  without a startup crash. This does **not** prove logged-in flows: the QA
  emulator has no authorized Google session, and the signed production APK
  remains unchanged. The full Flutter test suite passed 213 tests with one
  pre-existing Profile golden mismatch (0.37% pixels); analysis passed.

## Required cutover order

The branch now includes a dormant Vercel `proxy.ts` fence. It activates only
with `NAZRAA_CUTOVER_FREEZE=1`, returns a sanitized 503/retry response for
all old `/api` routes except internal health and for non-GET page requests
(including Control Server Actions). It blocks the Vercel cron and LiveKit
webhook too. The blanket API fence is deliberate because some game GET routes
perform settlement writes. A separately gated `NAZRAA_LEGACY_BRIDGE=1` rewrites
only `/api/v1/*` and `/api/public/*` to the fixed QA/VPS API hostname, leaving
Control, cron, webhooks and old Server Actions fenced. Local production-build
smoke tests returned the same 18,883-byte public config through the bridge and
direct QA API (both HTTP 200); invalid sign-in JSON forwarded as HTTP 400;
old cron, webhook and Control POST stayed HTTP 503. The full proxy unit test,
TypeScript check, build, and Caddy production-file dry-run passed. **Neither
switch has been deployed or enabled on Vercel.** At cutover, test authenticated
legacy mobile requests, request bodies, image upload size limits, auth headers,
and response parity against the final authority before opening the bridge to
all users. Never reopen writes against the stale shared database.

The old Vercel `vercel-build` previously always ran `migrate` and reviewer
provisioning before `next build`, which would violate a frozen old database
during a bridge deployment. It now selects a build-only path when
`NAZRAA_CUTOVER_FREEZE=1`, and refuses bridge mode without the fence. The
normal pre-cutover build retains its prior migration/provisioning behavior.
Pure plan tests and an actual frozen-mode production build passed locally.
This remains **unpublished code**, so final operations must also enforce the
old database write freeze outside Vercel while the new Vercel deployment is
rolling out; changing an environment variable cannot instantly stop already
running serverless instances.

The production Caddy configuration has been corrected to admit exactly the
`/api/internal/livekit/webhook` path on the API hostname while keeping every
other internal path private. The webhook route verifies the LiveKit signed
JWT/body digest before processing. The future frontend hostname now denies
all internal paths too. **This configuration is not yet active.** At cutover,
change the LiveKit webhook destination from Vercel to the new API hostname
only after the final database is authoritative, and verify signed delivery
before reopening Host Live writes. The current QA Caddy still denies the
webhook; production LiveKit and Oracle are untouched.

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
