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

Deployed on 6 October 2026. Scoped implementation commit `3ec266090bf0e2c9c9cd8772a163fb9a5e259104` was cherry-picked onto production as `16e736cca206853d0e4e96cf609c96c6a6eb303a`. Production image: `sha256:d5b490246fa1cda02f3c3479955774a1613b2cabe6eee9ae125f844645382c68`. Migrations 0098 and 0099 applied on the actual MariaDB service; follow-up guard reported no pending scoped migrations. API/worker promoted successfully; API, realtime, MySQL and Redis healthy. Caddy/realtime/database/media services were not recreated.

- Exact formerly failing sub-1 KB optimized banner uploaded successfully through authenticated Master Control. Preview appeared and public asset returned HTTP 200, `image/webp`, immutable cache and `nosniff`. It stayed disabled.
- A second owned-art QA banner was enabled, persisted across Control reload, appeared in the consumer bootstrap and visibly rendered in the existing Android APK. It was then disabled and confirmed absent from the active public list. Both QA banners are disabled; previous active artwork was not changed.
- New asset URLs: `https://api.nazraa.pixtra.site/api/v1/assets/banners/aa9d3108-2854-4a3e-b422-2bc3d5381f6f` (small regression asset) and `https://api.nazraa.pixtra.site/api/v1/assets/banners/fb4f6bab-7cc4-462e-8802-7e57e40c3dbc` (consumer-display QA asset).
- Public website and download page both HTTP 200. Public mobile config contained zero `vercel.app` references; all active banner links used the VPS origin. Current production `NAZRAA_PUBLIC_API_ORIGIN` is `https://api.nazraa.pixtra.site`.
- Created a controlled Face Live from the actual installed `2.4.76+7388` APK, using an existing owner-authorized ordinary authenticated account and emulator camera. Server clock and reward countdown ran. Master applied the 30-minute Face restriction through Control: active LiveKit media shutdown and accounting finalization were confirmed. The APK returned safely to the account screen; account and wallet remained usable. No gift/bet/claim financial mutation was performed.
- Read-only production verification of that room: `ENDED`; accounting `FINALIZED`; actual publishing time and committed progress **57 seconds**; `media_publishing=0`; reconnect state `ENDED`; accuracy `CONFIRMED`; zero completed reward units, correctly, because this was shorter than an hour. The existing completed-hour field remains zero according to the unchanged whole-hour policy. Integration separately verified a previously earned 3,500-Diamond claimable hour survives moderation without wallet mutation.
- New Face attempts showed remaining time plus exact eligible-again time (7:32 pm IST). Force-stop/restart of the APK preserved login and the server restriction, then showed the updated remaining time. Browser/API role and persistence tests used fresh authenticated sessions; a manual mobile logout/login was not performed because it would discard the available authorized session.
- Cleanup: Master restored the QA account's Live access. Control reload confirmed restriction `REVOKED`, account `ACTIVE`, Host `ACTIVE`, verification `VERIFIED`, and not currently Live. The emulator was returned to Home. Moderation/session/audit history was retained rather than deleted.
- FCM production credentials are configured and readable by the server. The test account had **zero registered push devices**, so zero delivery jobs could be queued for it. Durable FCM queue/configuration tests passed; actual device receipt is **N/A / not demonstrated**, not claimed as PASS. In-app enforcement did not depend on push.
- Anonymous moderation API on the actual public VPS returned 401 with a sanitized sign-in message. Actual production-build isolated HTTP tests covered all seven non-Master Control roles with 403. No real user's account was permanently banned for testing.

Proof screenshots are retained locally under `/Users/aishwaryam/nazra2/docs/control-release-20261006/`; they are not published to GitHub because they show authenticated app screens.

## Vercel and release decision

Production API, Control, database, Redis, realtime and public website use the VPS. No Vercel deployment was performed or required. The old Vercel hostname remains only as an older-APK compatibility/upgrade bridge; removing it before verified mandatory-upgrade behavior would strand clients that still call that hostname. It is not required by the current direct-VPS client or new banner links. Removing that bridge is a separate compatibility retirement, not part of these three changes.

No APK/AAB was built or version incremented for this task. The production download page currently advertises the pre-existing **2.4.77+7389** GitHub release; its metadata was preserved. Runtime moderation/banner compatibility was directly demonstrated on existing **2.4.76+7388**. The small Flutter restriction formatter/test already prepared in the older local workspace can accompany the next planned Play release; the tested existing APK already displays the required backend eligible-again message.

## Owner checklist

- Master banner upload, storage, DB, public retrieval, consumer display, disable/enable, validation and origin: **PASS**.
- Permanent account ban/unban and audit: **PASS** in isolated actual production-build tests. Country Manager, Super Admin, Admin, BD, CS, Agency and Coin Seller: **403 / BLOCKED**. Unauthenticated: **401**. Mobile accounts have no Control moderation authority or permanent-ban route.
- CS 30 minutes / 2 hours, arbitrary/permanent request rejection, server Face gate, deterministic repeat rejection, server expiry without cron, fresh-session persistence and audit: **PASS**.
- Actual existing APK restart persistence, eligible-again message/time and active Face shutdown: **PASS**. Mobile manual logout/login: **not run**; fresh authenticated backend sessions and durable persistence were tested.
- Other account/Party access unaffected: **PASS** in scoped regression; actual account/Home/wallet remained usable. Legitimate earned reward erased by moderation: **NO**.
- FCM restriction notice: **N/A** on the production QA account (no push registration); server queue/configuration tests **PASS**.
- Mobile/Flutter files changed: **YES**, minimum formatter/test prepared for the next planned release only. APK rebuild required for this task: **NO**.
- Unrelated intentional changes: **NONE**. Rollback and all pre-existing production edits preserved.
- Remaining implementation/release blocker for these three changes: **NONE**. Testing limitation: physical push receipt and manual mobile logout/login were not demonstrated.
