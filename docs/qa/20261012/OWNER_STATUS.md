# Owner two-track status — 12 October 2026

## Mobile — not yet released

APP PERFORMANCE ROOT BOTTLENECKS: confirmed primary renderer disposal during
Face/PK reparenting; concurrent pending connection/auth cleanup races; four
unawaited legacy ZEGO beauty calls in a LiveKit start; production presence
concurrent-read conflicts (MariaDB 1020). These are distinct issues, not a claim
that every network reconnect shares one cause.

APP START p50/p95: not measured sufficiently.
HOME p50/p95: not measured sufficiently.
FACE ROOM READY p50/p95: not measured sufficiently. Two independent browser
viewer media samples are recorded, not substituted for Android room-ready stats.

GOOGLE LOGIN ROOT CAUSE: native logout cleanup could overlap the next sign-in;
source serialization and ordering test pass. Actual 20-scenario login test pending.
GOOGLE LOGIN: not yet release-verified.
PLAY-SIGNED OAUTH CONFIG: blocked on access to the existing developer account.
Direct APK OAuth signing registration matches; no credentials were rotated.

PK LEFT FALSE RECONNECT: source/widget fix passed; real two-Host QA pending.
PK VIDEO STABILITY: real two-Host QA pending.
FACE VIDEO FREEZE: Host soak and independent viewer samples passed; no blanket
production-device guarantee. Actual viewer frame: 720 × 1280.
FACE 60+ MIN SOAK: PASS on the internal signed profile artifact.
RECONNECT GRACE: PASS for a 124-second network cut, same accounting ID.
REWARD PROGRESS PRESERVED: PASS, exactly one 3,500-Diamond unclaimed entitlement.
FACE→PK→FACE: 20 widget cycles passed, required real media cycles pending.
DUPLICATE TIMER: one canonical Live/reward pill observed, server and final UI
reconciled within one second in this session.
UPPER-AGE REWARD EXCLUSION: none found in the reward decision; no rule changed.
OVER-AGE OTHERWISE-ELIGIBLE HOST REWARD: no upper-age rule to remove; isolated
Host fixture with DOB 1940 retains canonical reward/authorization tests.

## Banner — deployed

ROOT CAUSE: Docker runtime omitted next.config.ts, restoring the default 1 MB
Server Action body limit. Existing configured 8 MB action limit is now loaded;
individual banner validation remains 2 MB plus type/integrity/auth checks.
SIMPLE BANNER UPLOAD: PASS in actual production Master session (1.3 MB PNG).
NAZRALIVE.IN PUBLIC ASSET: PASS, stored WebP loaded through the current API.
QA banner is disabled; existing app artwork was not replaced.

## Control — deployed and tested with actual isolated role accounts

AGENCY PANEL: PASS for scoped data, private identity hiding, separate Face/Party
activity, removed Monitor/Verification/Game access. Unsourced Party Board and
assigned-target fields explicitly say not configured.
ADMIN PANEL: PASS for removed team edit/suspend/password controls, hidden private
Host fields, removed Monitor/Verification and saved-USD payout display.
SUPER ADMIN: PASS for pending/approved Agency DP, all-scope saved Host/Agency
commission totals and removed Monitor/Verification.
COUNTRY MONITOR: PASS, scoped existing Device Block/Unblock retained.
CS/MONITOR: PASS, Host→Agency/Admin mapping, Live/Game reads, existing Device
Block/Unblock, exact 30-minute/2-hour Face restrictions. No new export permission.
MASTER: PASS for Total Country, Face/Party ledger tracking, verification ID
search, team edit/role/suspend and audited retirement, canonical Host Agency
transfer/removal and moderation controls.
MASTER AGENCY-WISE WITHDRAWAL SUMMARY: PASS, lazy Country→Agency→Host detail,
validated IST dates/search/status filters, saved snapshot totals, XLSX and CSV.
PERMANENT USER BAN MASTER-ONLY: PASS, all seven other roles denied directly.
COMPLETE ADMIN/SUPER ADMIN/MASTER EXPORTS: PASS on 10,005 ledger rows per role,
101-player Game summary/history and 31 withdrawal rows. No UI-page truncation.
Withdrawal/report XLSX over 20,000 filtered rows requires narrower filters with
an explicit error; unlimited XLSX generation is not claimed.

Direct HTTP, cross-Agency/Country, suspension restoration and immutable historical
withdrawal snapshots were tested. Typecheck/build/role tests pass; repository
integration passes 99 existing migrations and 29 assertion groups.

UNRELATED BUSINESS LOGIC CHANGED: NO. No wallet/reward/exchange, DNS, LiveKit,
Redis/WS routing, database schema or production media configuration changes.
CONTROL DEPLOYED VERSION: production cherry-picked HEAD e15be75, image
sha256:59f17256c24537b0b5b0609f5d3925a40e937adac0205acb2ac5a47d26bf62bc.
MOBILE VERSION IF REBUILT: no new distributed APK/AAB; public 2.4.77+7389 unchanged.

## Rollback and cleanup

Original API image retained as nazraa-api:rollback-control-20261012. Immediate
API rollback: retag that image as nazraa-api:production-candidate, then run
docker compose up -d --no-build --no-deps api from /opt/nazraa. Source rollback
branch rollback-control-20261012 and root-only predeploy-working-tree.patch are
preserved. The three pre-existing dirty production files remain unchanged.

QA room is ENDED, accounting FINALIZED at 4,185 eligible seconds, one reward
generated, and LiveKit listRooms reports zero matching rooms. Local QA servers
and temporary local DB credential were cleaned up. No production audit records
or rewards were deleted.

ONLY REMAINING RELEASE BLOCKERS: a second verified Host for real PK/cross-audio
tests; existing Play developer-account access; OCI maintenance access to inspect
the missing signed LiveKit webhook evidence. SSH still times out and VPS media
event count is zero, so a webhook PASS is not claimed. Twenty actual Google
login scenarios and Android performance measurements also remain unfinished.
