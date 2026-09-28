# Nazraa VPS staging stack

This stack is **not** a production cutover by itself. It stages the existing
Next.js API/control app beside private MySQL and Redis. `ws.nazraa.pixtra.site`
is deliberately not advertised until authenticated realtime delivery exists.

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

Before exposing Caddy, validate a restored **copy** of the production
database, migration version, financial row counts, and wallet/ledger totals.
Do not run `npm run migrate` or switch Flutter traffic against an unverified
copy. Stop writes on the old path before a final export/import if change-data
capture is unavailable. Keep only one authoritative writable database.

The compose file intentionally includes no public database or Redis port,
and does not change `rtc.pixtra.site` or `turn.rtc.pixtra.site`.
