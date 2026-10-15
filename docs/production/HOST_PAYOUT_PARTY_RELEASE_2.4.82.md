# Nazraa 2.4.82 +7394 — Host payouts and Party seats

Date: 2026-10-15 · additive migration `0103_party_admins_host_payout.sql`.

## Deployment

- Existing VPS Next.js/API and Control only; no infrastructure migration.
- Migration was applied before API and mobile publication. Current media routing,
  reward rules, economy, mobile cash-out switches and minimum version preserved.
- Only API container recreated; LiveKit, realtime, worker, DB, Redis and Caddy
  were not restarted. Production source's unrelated overlays were preserved.
- Public release: <https://nazralive.in/download>, version **2.4.82 / 7394**.
- GitHub: <https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.82>.
- Latest mobile version updated with SYSTEM audit; minimum remains **2.1.0**.

APK: `Nazraa-Live-2.4.82-7394-release.apk`, 224,508,269 bytes.

SHA-256: `d1d3f0d92706e3dd44c8f127ed184ac2e1433d5d1653f531760ff0660d7dbdc6`

AAB: `Nazraa-Live-2.4.82-7394-release.aab`, 177,733,027 bytes.

SHA-256: `a2a6a04a4d9e8a9582488a140aae28ca049b0fc22469302701e83a6690ac4faf`

Permanent signing certificate unchanged; package `com.nazraa.live`, target 36.
GitHub asset digests matched both local artifacts. The complete public APK was
downloaded on the production VPS and its size/hash verified independently.

## Host payout workflow

- Public portal: <https://nazralive.in/host-payout>.
- Master/Agency Control: <https://nazralive.in/dashboard/host-payouts>.
- Existing Google identity, separate HTTP-only Host-purpose cookie, nonce,
  same-origin and CSRF protection; no Host grant to private Control.
- Current canonical slab **125,000 Diamonds**. Total value **$11.70**, Host
  **$8.00**, applicable Agency **$1.00**, Company remainder **$2.70**. No new
  automatic Admin/SA/CM/BD/CS/Coin Seller entitlement. If no applicable Agency,
  that share remains Company. Historical legacy allocations are preserved.
- Requests reserve Diamonds atomically in the canonical wallet/ledger and
  auto-approve; approval does not mean actual payment. Immutable account/rule/
  Agency snapshots. DB-backed idempotency, exact-once failure/reversal.
- Master rules, account versions, paid/failure/reversal, Agency paid/reversal,
  correction notes/references, searches/filters, summaries and USD CSV audited.
- Agency can read only its scoped snapshots/commission; no rules/payment edits.
- USD-only presentation/export; internal minor units retain exact precision.
- New-workflow live summary is genuinely empty; synthetic tests did not create
  real production payouts or move real balances. Existing legacy withdrawals
  remain accessible in their preserved Control module.
- **Google website authentication completed:** owner explicitly approved the
  two origins `https://nazralive.in` and `https://www.nazralive.in`. Saved only
  those origins in the existing web client; Google confirmed "OAuth client
  saved", and reopening the client verified both persisted values. No client
  secret, scope, redirect URI, Android registration or Control permission was
  changed.
- Real existing Host Google sign-in PASS against production; own identity,
  available Diamonds, configured Host rate, empty account/history state and
  appropriately disabled payout button verified. Session survived refresh.
  Logout removed Host data; repeat sign-in restored the same Host without a
  manual refresh. No payout request or account edit/payment was performed.
  Authenticated screenshots remain private and are not published to Git.

## Party behavior

- Unlocked normal seat is claimed immediately by one server transaction; no
  Party approval popup. Locked/taken errors structured and English.
- Leave Seat and authorized Remove from Seat are distinct from unchanged Kick.
  They revoke mic publish permission and occupancy, retain room subscription,
  and preserve Owner/Admin permission. Stale seat-session actions are ignored.
- Durable Party Room Admin grant until explicit owner revocation. Join/revoke
  serialize on canonical grant with deadlock-safe retry. Offline roster/revoke
  supported. Scope is this Party room, not all future unrelated rooms.
- No global auth, ban, suspension or temporary-role expiry was removed.
- Reference applied only to seats: pink number, top-right Gift counter, empty
  sofa/lock, occupied DP/name/mic/role; Nazraa assets. Default 10 preserved;
  20 seats exactly four columns × five rows. Small layout compacts upward.
- Moderation times use IST independent of phone zone; server enforcement UTC.

## Verification evidence

- Flutter analyze clean; **285 Flutter tests PASS**; changed focused suite PASS.
- Core backend suites PASS: seat race, stale leave, Admin +25h/+7d/relogin/
  restart/re-entry/manual revoke, 10 join/revoke races, Agency lifecycle,
  reward claim, Gift/withdrawal ledgers, Face and PK, Party History and Audio PK.
- Control **30 integration groups / eight roles**, all migrations including
  0103 PASS; role matrix and game RTP regression PASS; production builds PASS.
- Financial fixtures: eight simultaneous retries reserve once, approved state,
  scoped reads, insufficient/invalid amount denial, immutable account/rate,
  paid/failed/reversal once, Agency outstanding/paid/reversal, fractional USD,
  no other-role allocations, audits and unchanged Android cash-out OFF.
- Owner's 100k example is invalid under the actual 125k slab; tested denial,
  not silently changing the canonical minimum to make that example succeed.
- Real production LiveKit **eight synthetic clients, two disposable QA rooms,
  12 received audio streams**: Host/seated cross-audio, muted silence,
  republish recovery, base publisher SIDs retained after PK cleanup. Mic
  permission revoked stopped publishing while subscription remained. Both
  rooms cleaned up; no secrets/tokens logged.
- Exact signed APK on Android 16: launch/Home, create controlled Party, take
  seat, leave seat and remain same board, locked/unlocked state, Room Admin
  roster, 20-seat 4×5, restore 10, Gift catalog, Teen Patti open/return, Close
  QA room. Empty Android crash buffer. No production Gift/bet/payment made.
- Face/Face PK are regression-tested and preserved, not claimed as a new
  physical two-Host E2E session in this batch.
- Master page verified under actual Master session. Anonymous management 401;
  anonymous portal has no Host data. Portal contrast checked and fixed as a
  web-only change. Narrow 320px check identified a fixed-width Google button;
  it now follows the real container width with a disposed ResizeObserver.
  Final deployed 320px and desktop browser checks PASS; no button overflow.
- Payout web request tests PASS: success, single financial dispatch with
  unchanged identity, bounded 20s timeout, offline/timeout/non-JSON/internal
  error sanitization and clear legitimate business denials. Retry clears stale
  error state; no implicit retry of a financial command.
- Read-only postdeployment verification: schema 0103, QA Party ENDED, layout
  restored to 10, no synthetic QA rooms or QA Party LiveKit room left,
  latest 2.4.82/minimum 2.1.0, audited update, Android withdrawal/cash switches
  both false, zero new real payouts, existing LiveKit service reachable.

## Recovery

- Verified encrypted off-VPS backup:
  `production/nazraa-nightly-20261014T211940Z.sql.gz`, 4,814,521,819 bytes;
  completed 2026-10-14 21:23:17 UTC via existing verified OCI workflow.
- Protected rollback source/image under
  `/opt/nazraa/backups/release-2.4.82`; image
  `nazraa-api:rollback-before-2.4.82`. Old 2.4.81 public assets retained.
- Restore only prior API image/source and prior version pointer if needed.
  Do not overwrite live DB writes or drop the additive new tables.
- Private local exact-APK screenshots/source snapshot are not published to Git.
  Sanitized mobile source SHA-256:
  `c7ea17fe0d32dec67199a3be1c6e58a2b5e1eae8a25d0439d9863ab507decc77`.

Unrelated business logic changed: **NO**.

Final application source includes reviewed changes through **29fb3a7**.
The server's historical Git HEAD/other overlays were not reset. Read-only
release maintenance helper commits do not change application behavior.

Google website-origin/sign-in blocker: **CLEARED**. No new APK or API
deployment was required for this console-only configuration completion.
