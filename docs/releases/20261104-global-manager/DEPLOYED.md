# Production verification

Deployed on the existing VPS at 2026-11-04 19:27:21 UTC (2026-11-05 00:57:21 IST).

- Implementation commit: `ba1dfe61631131a53798a6ed3ae7630cf1726d3c`.
- Deployed backend/runtime and guarded deploy commit: `bb461c7ab35c31dcaee8f98e4f0793a91c6e6f98`.
- Verified baseline: `7e3a0e34507ec80732449a734b1402636de95e97`.
- All 51 scoped production runtime/migration files matched both the expected base before deployment and the deployed commit afterward.
- Scoped patch SHA256: `375369188caac698ed389d56cbae01f3ff5c94acb2fffeb5a16b318596acce3f`.
- Migration 0117 recorded exactly once; Middle East verified with 17 canonical country memberships.
- Protected game/media settings, account roles and hierarchy/owner links remained unchanged. Princess remained target 80%, v31.
- Only `nazraa-api-1` was recreated. All 19 other running containers retained identical IDs and start times.
- Internal database readiness: `ready`; Docker health: `healthy`.
- Public config, download and login HTTP 200. Unauthenticated Global Manager dashboard goes to normal login; payout management API denies with 401.
- Public `latestVersion=2.5.18`, `minimumVersion=2.1.0`, update URL `https://nazralive.in/download`. No mobile code or release pointer was changed.

Master entry points:

- https://nazralive.in/dashboard/global-managers
- https://nazralive.in/dashboard/game-management/economy

No real Global Manager account was assigned because the owner has not specified its Nazraa ID. Master can create and assign any intended existing account using the delivered interface. The existing Master browser session expired on reload; authenticated visual screenshots therefore use the isolated QA database, not fabricated production authentication. Production source/schema/config/health verification was performed through the authenticated existing VPS console.

Rollback retains `/opt/nazraa/tools/global-manager-20261104/source-before.tar.gz` and image `nazraa-api:before-global-manager-20261104`. The guarded script automatically restores source/image on failed activation. A later manual rollback should retain additive schema and new assignments, restore only this patch's source files, tag the saved image back to `nazraa-api:production-candidate`, and recreate only the API with `docker compose --project-directory /opt/nazraa -f /opt/nazraa/compose.yaml up -d --no-deps api`.

Evidence directory: `/Users/aishwaryam/nazraa-release-evidence/20261104-global-manager-rtp`.

It contains final build/typecheck/role/HTTP/scope tests, six 100k model simulations, next-round version tests, QA screenshots, production terminal proof, public sanity results and `production-verification.json`. Additional actual-MySQL checks verified legacy CS actor history does not expose foreign-team/wrong-country targets through either audit list or recent activity.

Known mathematical protections: Pro target excludes Crown; ordinary-area targets do not promise universal multi-selection RTP; Jungle Hunt and stateful King specials lack a verified scalar adapter; Lion vs Tiger stays fixed at 30/31. They are explicitly labelled/protected rather than assigned invented formulas. The broad legacy integration suite still stops at its obsolete monthly-Diamond-reset assertion; focused task gates, production build and deployment checks passed.
