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
PLAY-SIGNED OAUTH CONFIG: existing Play account accessed and signing certificates
verified on 13 October. Google Cloud has the direct-APK certificate registered,
but neither Play certificate. Adding the two Android registrations is awaiting
the explicit action-time approval already requested. No credentials were rotated.

PK LEFT FALSE RECONNECT: source/widget fix passed; real two-Host QA unverified.
PK VIDEO STABILITY: real two-Host QA unverified. Owner explicitly declined
waiting for another verified Host on 13 October; this is not a request for
another account and is not reported as a runtime PASS.
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

UNRELATED BUSINESS LOGIC CHANGED: NO. No wallet/reward/exchange, DNS, media
transport, Redis/WS routing or database schema changes. The obsolete LiveKit
webhook URL correction below is the authorized accounting-evidence repair.
CONTROL DEPLOYED VERSION: Control update initially verified at production HEAD
e15be75. Subsequent webhook-timestamp correction is healthy at production HEAD
875d341, image
sha256:6494364e5402f23fb25a318a91a5b96b3c8ae007515db591b9990f5d615a2d1f.
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

## 13 October — access, signing and webhook follow-up

- Existing Nazraa Play developer/app accessed under the owner-selected account.
  Public signing certificates were downloaded and verified with OpenSSL.
  Current Play SHA-1 is
  `37:B9:D1:63:4F:8C:6E:77:9E:48:BE:B8:2F:2D:54:1E:E9:84:51:78`;
  previous hybrid-classical SHA-1 is
  `3A:7C:63:9C:F0:7C:66:EF:A2:24:D1:BC:A7:3A:53:12:F0:46:9E:6E`.
  Existing Android OAuth is only the upload/direct-APK SHA-1
  `24:84:A4:B2:29:C4:23:DA:7D:E2:90:D2:1B:6A:55:F9:72:C2:40:13`.
- Existing OCI Cloud Shell RSA identity reaches the production replacement VM.
  No firewall, IAM, credential or paid-resource expansion was necessary.
  Running LiveKit is `v1.13.7`, host networking, zero container restarts since
  16 September. Caddy and Redis remain unchanged.
- Exact missing callback mechanism: LiveKit's running configuration sends to
  `https://nazraa.vercel.app/api/internal/livekit/webhook`, not the current VPS.
  The destination was changed on disk only to
  `https://api.nazraa.pixtra.site/api/internal/livekit/webhook`, with a root-only
  rollback copy. A bounded 900-second guard checks actual room participants
  and will restart only LiveKit if none are connected. Activation is not yet
  claimed while real users are publishing.
- Actual signed VPS connectivity probe: valid 202; bad signature, tampered body
  and expired token each 404. Probe uses an unsupported empty event and creates
  no media/reward record. These tests do not substitute for real provider delivery.
- A second defect was reproduced using the provider SDK serializer: protobuf
  int64 `createdAt` is a string, which the old code treated as receipt time.
  The focused fix preserves the signed source timestamp. Staging, typecheck,
  eight-role and isolated integration checks pass; API-only deployment is
  healthy. Previous API image/source are retained as
  `rollback-webhook-time-20261013`; all three pre-existing source edits survive.
- Latest Flutter source: analyze zero issues and all 244 tests pass. Fresh
  internal profile APK built and installed on emulator-5554; this is not a
  newly distributed APK/AAB and does not establish new runtime QA by itself.

REMAINING: approval for the two Play Android OAuth registrations; safe activation
and actual signed-provider delivery of the staged webhook; twenty real Google
login scenarios and measured Android startup/Home/Face latency. Two-Host PK
runtime remains explicitly unverified, with further account waiting waived by
the owner. Public release stays 2.4.77+7389, not newly certified/replaced.
