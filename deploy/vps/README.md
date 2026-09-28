# Nazraa VPS staging stack

This stack is **not** a production cutover by itself. It stages the existing
Next.js API/control app beside private MySQL and Redis. Do not publish
`ws.nazraa.pixtra.site` until authenticated realtime delivery passes QA.
The worker currently replaces only the existing daily Vercel reset check;
enable it against the authoritative DB only after cutover.

Place the repository at `/opt/nazraa/app`, this compose file at
`/opt/nazraa/compose.yaml`, and the Caddyfile at
`/opt/nazraa/config/Caddyfile`. Create root-owned `0600` files
`/opt/nazraa/config/app.env`, `mysql.env`, and `caddy.env` from the current
production configuration; never commit or print their values. The MySQL and
Redis services have no published host ports.

`app.env` must contain the existing server-only production auth, LiveKit,
Google, encryption, and DB credentials. Set `DB_NAME`, `DB_USER`, and
`DB_PASSWORD` to the imported VPS database. `mysql.env` supplies the same
database/user/password plus a distinct `MYSQL_ROOT_PASSWORD`. `caddy.env`
contains `ACME_EMAIL` for certificate notices.
The KVM 4 staging defaults reserve 4 GiB for the MySQL buffer pool, 512 MiB
maximum for Redis, a 10-connection API pool, and a 100-connection MySQL
ceiling. These are initial caps, not measured production tuning. Override via
`MYSQL_BUFFER_POOL_SIZE`, `REDIS_MAXMEMORY`, `DB_POOL_LIMIT`, and
`MYSQL_MAX_CONNECTIONS` only after measuring actual VPS memory/concurrency.
After the VPS API domain passes TLS and asset-route QA, set
`NAZRAA_PUBLIC_API_ORIGIN=https://api.nazraa.pixtra.site` in `app.env` so new
backend-generated avatar, Gift and room asset URLs point at the VPS. The
default remains Vercel for existing production deployments.

Before exposing Caddy, validate a restored **copy** of the production
database, migration version, financial row counts, and wallet/ledger totals.
Do not run `npm run migrate` or switch Flutter traffic against an unverified
copy. Stop writes on the old path before a final export/import if change-data
capture is unavailable. Keep only one authoritative writable database.

The compose file intentionally includes no public database or Redis port,
and does not change `rtc.pixtra.site` or `turn.rtc.pixtra.site`. The API binds
only to the VPS loopback address for private SSH-tunnel QA. The `edge` Caddy
profile and `cutover` worker profile must not be started until DNS, database
authority and feature parity are verified.

The `edge` profile includes an authenticated WebSocket server. It calls the
API's private authorization route for each room subscription using
`REALTIME_INTERNAL_SECRET` (at least 32 random bytes, same value only in the
API and realtime containers). That route is blocked by Caddy and disabled
when the secret is unset. The WebSocket server has no client-side publish
permission; Redis is its private event source. This is transport preparation,
not proof that every room/game event has been migrated away from polling.
