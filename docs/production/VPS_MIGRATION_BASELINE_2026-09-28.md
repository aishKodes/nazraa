# Nazraa VPS migration baseline — 2026-09-28

This file records the pre-cutover state. It is not evidence that database
copying or production routing has occurred.

## Protected rollback point

- Hostinger now shows a running KVM 8 VPS (8 vCPU, 32 GiB RAM, 400 GiB disk)
  in India–Mumbai at `187.126.115.185`, VPS ID `2017514`, hostname
  `srv2017514.hstgr.cloud`. The installed OS is Ubuntu 26.04 LTS, not the
  previously requested 24.04 LTS. Verify package compatibility before
  hardening; no VPS application services have been installed yet.

- Current Vercel project: `vedanath/nazraa`.
- Production alias: `https://nazraa.vercel.app` (the only domain shown in
  Vercel's project-domain list).
- Ready production deployment: `3W78G2PBJ7Nqo5dvzUQeE9W4nWJ5`, source
  commit `d21bbf6da4384a545738c8fdbcc7c4d9e4fe6416`.
- Vercel region in `vercel.json`: `bom1`.
- Existing MySQL remains on Hostinger shared hosting. A read-only connection
  from this Mac timed out (`ETIMEDOUT`); do not interpret this as a production
  DB outage. Live Vercel serves traffic. Production DB migration/version,
  row counts, financial totals, size, and backup status remain **unverified**
  until connected from an allowed network or Hostinger's database tools.
- A fresh empty-schema replay on local MySQL 9.6 with
  `utf8mb4_general_ci` stopped at migration `0029` on an FK collation
  mismatch. The project's integration test created a database with
  `utf8mb4_unicode_ci` and successfully replayed migrations `0001`–`0092`.
  VPS staging therefore defaults to `utf8mb4_unicode_ci`. This still does
  **not** establish whether a full production SQL dump imports on target
  MySQL 8.4; test that exact dump rather than recreating the schema.
- Existing Oracle LiveKit/TURN endpoints and DNS are outside this migration.
- Current DNS A lookup: `api.nazraa.pixtra.site`, `ws.nazraa.pixtra.site`
  and `nazraa.pixtra.site` have no A answer yet; `rtc.pixtra.site` and
  `turn.rtc.pixtra.site` both answer `129.154.246.135`. Do not alter the
  Oracle records.
- Current downloadable mobile release is `2.4.65+7377`. Its production
  `AppEnvironment.apiBaseUrl` defaults to `https://nazraa.vercel.app`.
  `NAZRAA_API_BASE_URL` is a build-time Dart define, so an existing APK cannot
  switch directly to a new VPS hostname through backend config alone.
- A 20-request sequential GET sample of the public
  `/api/v1/config` endpoint from this Mac measured p50 **235 ms**, p95
  **292 ms**, min 208 ms, max 754 ms. This is a narrow network baseline, **not**
  authenticated room/game latency and not an India-wide user p95.

## Application inventory

| Area | Current location/behavior | Migration implication |
| --- | --- | --- |
| API/control/public site | One Next.js 16 app; 26 API route files including one `/api/v1/mobile/[resource]` dispatcher | Initially run the same app on VPS to preserve contracts; frontend can remain on Vercel until API passes |
| Mobile auth | Google session and 180-day bearer session rows in MySQL; global device bans checked server-side | WebSocket auth must verify existing session and block state; no separate identity store |
| Economy | Wallet balances/ledger, Gifts, bets, rewards and claims use MySQL transactions/idempotency | One writable DB only; no data-only snapshot cutover during writes |
| Live media | Backend issues LiveKit role tokens; LiveKit/TURN runs on OCI | Keep OCI unchanged; copy server-only token credentials securely |
| Game rounds | Shared-round state, bets and settlements in MySQL; Flutter polls game snapshots around 900 ms | Workers/Redis event migration must preserve durable bet acknowledgement and exact settlement |
| Room presence | Party has a 5 s timer; Face uses a 5 s tick with full SQL presence roughly every 10–15 s | Current polling remains until authenticated WS/Redis parity; cannot claim it removed yet |
| PK/seats | Existing MySQL-backed room/PK authority and LiveKit seat/media checks | Preserve authoritative seat/session IDs and reconnect behavior |
| Scheduled work | Vercel cron calls `/api/cron/monthly-host-reset` daily at 18:35 UTC; some maintenance runs in request `after(...)` | Replace cron only after VPS worker idempotency and production verification |
| Assets | Multiple backend response/SQL URLs hardcode `nazraa.vercel.app` | Make output origin configurable before direct mobile cutover; old links must remain valid |
| Secrets | Vercel Production stores DB, session, document-encryption, LiveKit, Google OAuth, cron and legacy ZEGO variables | Copy only needed values through secure server-side channel; never log or commit them |

The Vercel `vercel-build` command currently runs `npm run migrate` before
`next build`. Do not push this migration branch to the linked GitHub repository
until preview deployment behavior and DB credentials are isolated; an
automatic preview deployment could otherwise reach the shared production DB.
The VPS Dockerfile uses `npm run build` and never runs migrations implicitly.

## Migration safety gates

1. VPS purchase and provisioned Mumbai location are verified in Hostinger.
2. Restored staging DB passes full schema compatibility; do not assume the
   current shared-DB flavor is compatible with MySQL 8.4.
3. Record the applied migration list, critical row counts, wallet/ledger
   reconciliation, DB size and backup checksum **from production**.
4. Test API contract/auth parity and financial idempotency on a private copy.
5. Implement and test authenticated WS/Redis events before disabling mobile
   polling; never equate container startup with realtime readiness.
6. If replication/change capture is unavailable, freeze all financial writes,
   take a fresh final export, import and reconcile, then open one new writable
   DB. A Vercel rollback after new-DB writes must point the old app at the new
   DB, never at a stale shared-DB snapshot.
7. Release a newly signed APK configured for the stable new API entry point;
   existing APKs continue using Vercel until retired or safely proxied.

No production DNS, database, Vercel deployment or LiveKit setting has been
changed by this baseline audit.
