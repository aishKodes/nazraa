# Nazraa performance canary baseline — 2026-09-08

## Frozen production path

- Mobile release: `2.4.42+5355` (package `com.nazraa.live`).
- Mobile API base URL: `https://nazraa.vercel.app` is compiled into the current Android release.
- API runtime: Vercel production, configured for `bom1` (Mumbai).
- Database: the existing authoritative Hostinger MySQL schema. No second database, wallet copy, game ledger copy, or financial-data migration is permitted for this canary.
- Schema baseline: migrations through `0074_room_blocks_and_hot_path_observability.sql`, confirmed applied on 2026-09-08.
- The prior Vercel production deployment remains retained by Vercel as an immediate rollback target.

## Experiment boundary

The Hostinger comparison service may expose only authenticated, non-public, non-destructive benchmark/canary operations until all of the following pass: response-schema parity, authorization parity, database idempotency, bounded concurrency, monitoring, and rollback.

The Flutter base URL, public routing, ZEGO routing, CDN/mixer controls, and financial command handling are frozen during measurement.

## Rollback

1. Keep `https://nazraa.vercel.app` on the current Vercel production deployment.
2. Keep Hostinger canary hostnames isolated from mobile traffic.
3. Disable any endpoint-level canary flag before changing traffic percentage.
4. For a failed Hostinger canary, route only that non-financial endpoint back to the Vercel implementation; do not replay financial commands across runtimes.
5. Do not remove the prior Vercel deployment during the rollout period.
