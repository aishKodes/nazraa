# Master financial controls — 21 October 2026

## Scope and deployed state

Existing VPS/Control only. No Flutter change, APK rebuild, media change, reward
change, payout-rate change or new currency. Current mobile release stays
2.5.02+7414.

Production Control: https://nazralive.in/dashboard

Master adjustment screen: https://nazralive.in/dashboard/wallet/adjustments

API-only deployment passed, with an encrypted off-VPS predeploy database backup
and 19 per-file SHA-256 source guards. No migrations were added or applied.
Production retained 111 migrations, latest `0109_host_auto_resume.sql`.
The full ordered `system_settings` digest matched before and after deployment.
Production SQL session timezone is +00:00; system timezone is UTC. Relevant
Control displays remain Asia/Kolkata / IST without changing stored timestamps.

Backup verified: `nazraa-predeploy-20261021T085828Z`, 563,326,258 bytes, existing
private encrypted OCI backup destination. No new backup credential or service.

Rollback source:
`/opt/nazraa/backups/master-controls-20261021-source-1792574192.tar.gz`

Previous API image tag: `nazraa-api:master-controls-rollback-20261021`.
Deployment helper automatically restores scoped sources and the old API image
on build/start/health failure. No worker/Redis/DB/realtime/LiveKit restart.

The final retirement-list correction is a separately guarded one-file
follow-up, backed by `nazraa-api:master-controls-listing-rollback-20261021`
and its `master-controls-20261021-listing-source-*` source archive. The original
pre-task rollback image/archive above remain available. Its new regression
assertions verify exclusion from Team exact-ID search and normal selectors,
while retained ledger references still resolve.

## Implemented / reused

- Wallet → Master adjustments: exact User/Host ID search; DP or placeholder,
  name, public ID, current status, Agency and both available balances.
- Review step displays target, asset/action, amount, current balance and
  expected new balance. Final explicit confirmation is separate from review.
- Four types in the existing `ledger_transactions` table:
  `MASTER_COIN_CREDIT`, `MASTER_COIN_DEBIT`, `MASTER_DIAMOND_CREDIT`,
  `MASTER_DIAMOND_DEBIT`. One ledger entry and one audit event per adjustment.
- Existing global unique ledger idempotency key; actor/user/wallet locking;
  positive safe whole-number validation; stale-balance and overdraft rejection;
  no reserved-balance mutation. Interrupted requests retain the exact payload
  and key for safe retry. Conflicting reuse returns 409, never a second credit.
- Rechecks active Master role in the transaction. Mandatory reason and
  optional internal note are durable; note is not in mobile wallet responses.
- Paginated Master history with actor, target, before/after, reason, note and
  IST timestamp. Same single financial entry appears in normal ledger/history.
- Existing Total Country counts normalized distinct Country Manager ISO codes,
  excluding removed/disabled Country records; not user-profile country text.
- Existing Host/CS operational component now uses the **same** Party Board
  history and summary as mobile, including current-month hours, valid days,
  daily completion and remaining requirements. Existing canonical targets
  remain 50 minutes/day, 20 hours/month and 24 valid days; no policy change.
  Face valid days match the existing mobile Live History threshold calculation.
- Master Agency tracking shows current Coins separately from available/reserved
  Diamonds, authoritative Admin/Super Admin IDs, submitted Diamonds and saved
  Host/Agency paid/pending USD. Agency Owner Host wallets group under their own
  Agency, matching existing payout routing. No historical rate recalculation.
- Team ID editing is Master-only, six-digit/unique, with stale-ID protection,
  old/new audit. Internal UUID, hierarchy references and historical snapshots
  remain unchanged. Existing name/contact edits, role change and status controls
  retain their existing permissions.
- Permanent retirement is separate from suspension and uses one locked
  transaction. Checks downstream accounts, Host profiles, user associations
  and pending Agency applications. UUID/tombstone and immutable financial,
  gift, withdrawal, security and audit references remain. 57 existing account
  foreign-key references were inventoried; no physical DELETE/cascade is used.
  A final follow-up excludes retired records from both normal Team pagination
  and account selectors; exact old/new public-ID searches cannot resurface them.
- Existing Master Host Agency remove/transfer reused. Current Agency ID is
  shown; expected-source protection is also accepted by the direct API.
  Host/user mappings change together; historical payout snapshots remain.
- Verification exact-ID search, review/verified workflow, Country/CS scoped
  device blocks, Master Monitor and authorized Live/Game reports reused.
  Numeric Monitor queries now match exact IDs, not unrelated phone substrings.
  Country/CS do **not** receive Master's all-account permanent device-ban power.
- CS Host search shows gender, Agency/Admin mapping and canonical operations,
  without phone/email contacts. Existing scoped device workflow is unchanged.

## Endpoints / actions

- New `POST /api/control/wallet-adjustments`: session auth; Master-only;
  existing configured Control-origin check; strict body validation;
  401/403/400/409/503 sanitized failures; no-store response.
- New `GET /dashboard/wallet/adjustments`: Master-only server-rendered search
  and paginated history. Linked from the existing Wallet page.
- Extended `POST /api/control/hosts/agency`: optional `expectedAgencyId` for
  stale-confirmation protection. Existing users of the endpoint remain valid.
- Existing `submitAccountEdit` adds Master public ID / expected old ID.
- Existing permanent-removal, Host operations, Agency tracking and Monitor
  server reads reuse current routes and guards; no duplicate device system.

## Test evidence

- `npm run typecheck`: PASS.
- Scoped ESLint over all changed runtime TS/TSX files: PASS.
- `git diff --check`: PASS.
- `npm run test:roles`: PASS, all eight roles; wallet.adjust only Master.
- `npm run test:integration`: PASS, existing 30 Control integration groups.
- Focused isolated Master-finance suite: PASS. Four adjustment directions;
  20 concurrent same-key retries produce one +100 credit; concurrent different
  keys with the same confirmation allow only one change; stale/overdraw/zero/
  negative/fractional/unsafe/unconfirmed/conflicting-key requests rejected;
  reserved Diamonds unchanged; ledger/audit counts agree; all seven non-Master
  roles rejected; ID collision and immutable retirement-history checks;
  Host transfer/remove and stale source rejection; verification exact ID;
  Country block/unblock uses existing device table; CS mapping/privacy; actual
  50-minute Board fixture yields one valid day and 69,000 remaining seconds.
- Built Next HTTP suite: PASS. Anonymous 401, every non-Master role 403,
  untrusted Origin 403, unconfirmed 400, altered same-key payload 409; 20
  parallel requests return the same transaction ID and exactly one +100 credit;
  unauthorized direct pages cannot expose history. CS HTML excludes seeded
  private phone/email. No real production financial mutation was used.
- Optimized production Next build: PASS locally and on the VPS.
- Production public config / API container health: PASS; new anonymous
  adjustment API returns 401. Master session opens deployed adjustment UI.

## Screenshots

`master-adjustment-live.png` is the actual production page. Other screenshots
are visibly labelled QA accounts on an isolated localhost database, not
manufactured production financial activity:

- `master-adjustment-confirmation-qa.png`
- `master-adjustment-history-qa.png`
- `host-agency-transfer-qa.png`
- `country-device-control-qa.png`
- `cs-host-search-qa.png`

## Deliberate limits

No separate assigned Face or Agency target source exists in the canonical
schema. Those fields remain explicitly **Not configured**, rather than
inventing targets/percentages. Existing Party Board targets are available and
are now shown correctly. Retirement preserves retained identity/history; it
is not a physical database purge. No real account was retired for QA.
