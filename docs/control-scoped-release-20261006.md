# Scoped Control release — 6 October 2026

Only three owner-approved areas: banner upload, Master-only permanent account ban, and CS 30-minute/2-hour Face suspension. No economy, game, PK, or LiveKit transport changes.

## Baseline and production topology

- VPS source `/opt/nazraa/app-next`, baseline `ff25f353d805fd80b929b07c72ad5da9d6303034`.
- Current source for the scoped modules matches the newer local checkout exactly. Only this scoped commit is to be cherry-picked, not the older dirty checkout.
- Production API, Control, MySQL, Redis and WebSocket services run on Hostinger VPS. Public website `https://nazralive.in`; API `https://api.nazraa.pixtra.site`; WS/RTC/TURN domains remain unchanged.
- Preserve three pre-existing production edits: policy page, mobile session route, latest-release metadata. No APK rebuild or minimum-version change for this release.

## Confirmed banner root cause

Master upload of normal artwork succeeded in production. A valid 300×100 PNG optimized to WebP below 1,000 bytes failed the existing `banner_assets` CHECK and leaked a database error in Control. Migration 0099 replaces only that minimum-size heuristic with positive size up to 2 MB. Existing MIME/decode/pixel-count/upload limits remain. Errors are sanitized. Control previews stored images. Existing own-origin Vercel banner links are emitted using the VPS API domain, without copying/deleting stored assets.

## Authorization and Face-only moderation

Permanent ban/unban is Master-only at canonical repository and HTTP entry points. CS has only 30/120-minute Face suspension. It reuses `moderation_restrictions`, not an account ban. Server expiry is checked on authorization; no cron dependency. Repeat active suspension is rejected deterministically. Active Face media is terminated and valid earned claimable rewards finalized through the existing ledger. Party/account/wallet access remains available. Audit, in-app notification and existing durable FCM queue are used. Face restriction dates in Control are IST.

## Tests before deployment

- TypeScript, role matrix, VPS-origin tests: PASS.
- All migrations and 29 Control integration groups: PASS, including consumer banner bootstrap, asset HTTP 200, disable/re-enable, invalid/oversize validation, exact 30/120-minute expiry, Party access, earned 3,500-Diamond claimable reward preservation with wallet unchanged, and Master-only permanent bans.
- Core-mobile regression suite: PASS.
- Next production build: PASS. Lint: no errors; four pre-existing image warnings.
- Actual HTTP test against the production build with isolated QA database: anonymous 401; every non-Master Control role ban 403; Master ban/unban 200; CS 30/120 minutes 200; manipulated/permanent/repeated requests rejected; Admin Face suspension 403; untrusted origin 403. No real production account was banned for testing.

## Deploy/rollback safety

Retain `nazraa-api:rollback-control-20261006`, a baseline Git branch, pre-existing dirty patch, full schema backup and touched-table dumps under private `/opt/nazraa/backups/control-20261006`. Build the candidate before promotion. `deploy/vps/migrate-scoped-control.cjs --check` must find only 0098/0099 pending. Apply these additions; do not migrate unknown pending files. Recreate only API/worker after candidate succeeds; leave RTC/WS infrastructure unchanged.

Rollback code using the retained image and baseline source. The additive enum and positive banner CHECK are backward-compatible with the old service; do not destructively restore user data or remove post-deploy moderation records. Restore the pre-existing edits if any source rollback is performed.

## Production verification

Pending deployment verification. Test banners must remain disabled after the enable/disable test. FCM queued/configured is not the same as delivered to a device. Do not claim physical-device suspension/FCM runtime tests when only isolated backend evidence is available.
