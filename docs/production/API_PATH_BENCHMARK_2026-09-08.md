# Nazraa API path benchmark — 2026-09-08

## Safety boundary

- Production mobile traffic remains on `Flutter -> https://nazraa.vercel.app -> Mumbai (bom1) functions -> authoritative MySQL`.
- No mobile base URL, financial command, wallet/game table, ZEGO route, or production database schema was switched.
- A separate, Git-backed Hostinger Node 22 web app was deployed on a temporary Hostinger domain. It exposes only a key-protected, mutation-free benchmark endpoint; it received no client or canary traffic.
- The Vercel rollback point remains the preceding production deployment. Rolling back is an alias promotion/redeploy operation; no database rollback is required because this work made no migration.

## Method

Measurements were made from the India development network against the protected benchmark endpoints. Each operation uses production-shaped `SELECT` queries only and returns timings/counts, never user, room, wallet, media, or verification data. `dbQueryAggregateMs` is the sum of query durations, so parallel queries can make it larger than elapsed wall time.

The sequential table is ten successful samples per operation. With only ten samples, the reported p99 is the largest sample and is directional rather than a statistically stable tail estimate.

## Vercel / Mumbai results (milliseconds)

| Operation | Client p50 / p95 / p99 | Server p50 / p95 / p99 | DB acquire p50 / p95 / p99 | SQL aggregate p50 / p95 / p99 | Success |
| --- | --- | --- | --- | --- | --- |
| Room bootstrap | 542.51 / 1746.74 / 1746.74 | 451.10 / 1654.80 / 1654.80 | 433.10 / 1430.70 / 1430.70 | 28.30 / 440.00 / 440.00 | 10/10 |
| Room block | 371.99 / 2087.88 / 2087.88 | 274.20 / 2001.60 / 2001.60 | 262.20 / 1990.60 / 1990.60 | 11.60 / 20.50 / 20.50 | 10/10 |
| Profile lookup | 527.88 / 1816.02 / 1816.02 | 439.10 / 1727.70 / 1727.70 | 426.90 / 1713.50 / 1713.50 | 15.60 / 21.00 / 21.00 | 10/10 |
| Game-bet validation shape | 434.47 / 735.77 / 735.77 | 341.20 / 583.20 / 583.20 | 319.90 / 358.30 / 358.30 | 30.80 / 441.80 / 441.80 | 10/10 |
| Discover | 282.22 / 1061.75 / 1061.75 | 193.80 / 961.80 / 961.80 | 185.60 / 952.90 / 952.90 | 9.90 / 13.90 / 13.90 | 10/10 |
| Gift preparation shape | 231.88 / 941.24 / 941.24 | 142.90 / 851.70 / 851.70 | 121.20 / 832.20 / 832.20 | 27.30 / 39.60 / 39.60 | 10/10 |
| Verification-finalization shape | 460.13 / 1107.40 / 1107.40 | 371.90 / 992.30 / 992.30 | 165.50 / 980.80 / 980.80 | 15.30 / 227.10 / 227.10 | 10/10 |

### Safe bounded concurrency

Room bootstrap, 20 total read-only samples at a maximum of five concurrent requests: 20/20 HTTP 200; client p50/p95/p99 `416.05 / 1704.47 / 1716.52`; server `331.70 / 1421.10 / 1427.80`; DB-acquire `311.70 / 1400.80 / 1408.90`; SQL aggregate `27.50 / 232.90 / 642.90`.

The remaining 10/25/50/100 Hostinger comparisons were deliberately not run. The parallel candidate cannot yet authenticate to the authoritative production database, so scaling it would measure only failures and would add avoidable load to the live system.

## Hostinger candidate status

The Node 22/Express runtime and its public non-sensitive health check deployed successfully. Its protected benchmark requests fail with sanitized HTTP 503; Hostinger runtime diagnostics report `ER_ACCESS_DENIED_ERROR` when it tries to acquire the authoritative MySQL connection.

The current Vercel production DB credentials are intentionally stored as non-exportable Vercel secrets. The local configuration and prior transfer values contain redacted placeholders, not usable credentials. No password was guessed, logged, rotated, or copied into source control. No production user, database, or grant was changed.

## Decision

**KEEP VERCEL.** Hostinger has not met the mandatory canary gates: authoritative-DB authentication, response-schema/auth parity, idempotency parity for writes, and bounded concurrency. A direct mobile switch or a Vercel-to-Hostinger second hop would currently be less safe and is not justified by a valid comparison.

## Existing pool and capacity safeguards

- Vercel runtime region: `bom1`.
- Production pool default: one connection per warm runtime, capped at two if `DB_CONNECTION_LIMIT` is explicitly raised; queue limit 100; 12-second connection timeout; five-second idle retirement; safe retry only for transient reads.
- No retry wrapper was added around financial writes.
- Hostinger Business plan observed for the canary: Node 22 available, 2 CPU, 3 GB RAM, 120 process limit. Existing observed account DB user limit: 75 concurrent connections. These are capacity signals, not authorization to raise pools.

## Next safe step, if a Hostinger comparison is still desired

Provision a dedicated **read-only** MySQL credential for the actual production database, scoped to the benchmark `SELECT` tables only and to the Hostinger web-app origin. Store it directly as Hostinger web-app secrets. Then repeat the same benchmark matrix, including bounded 5/10/25/50/100 concurrency, before considering any hot-path canary.
