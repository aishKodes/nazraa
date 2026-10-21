# Master Coin / Diamond Allocation — 21 October 2026

## Scope

Existing Control section: `https://nazralive.in/dashboard/wallet/adjustments`.
Wallet page links to **Coin / Diamond Allocation**. No mobile change or APK rebuild.

- `GET /api/control/wallet-adjustments/search?q=<visible-ID-or-prefix>&page=1`
- `POST /api/control/wallet-adjustments` (existing endpoint, backward compatible)
- Search, history, page and writes require the existing `wallet.adjust` permission **and MASTER role**. Sessions recheck active account status from the database. Writes recheck active/non-retired Master inside the transaction.

## Account lookup and indexing

One bounded query covers application users (normal, Host, Agency-associated, independent, suspended/inactive) and non-retired platform accounts that already own a supported wallet. App wallets and platform inventory wallets remain separate; owner type is explicit in cards, request, ledger and audit. No phone/email/DOB is returned. Legacy UUID/OAuth-style external IDs are not displayed as public Host handles.

Exact public/Host IDs precede prefix matches. Whitespace and harmless case differences are normalized. The UI debounces 250 ms, cancels obsolete requests, ignores stale replies, times out after 12 seconds, supports Retry and returns 20 rows/page with bounded Show more. Selection collapses results into one account/form card. Substring-with-leading-wildcard scanning is deliberately not used: ID-prefix search keeps existing indexes usable and predictable. No browser-side full directory download.

Reused indexes; **no SQL migration**:

- `application_users.uq_application_user_public_id` (numeric exact/range prefix)
- existing unique/indexed `application_users.external_user_id` (exact/prefix)
- `platform_accounts.uq_platform_account_public_id`
- `wallet_balances.uq_wallet_owner_asset`
- existing unique `ledger_transactions.idempotency_key`, transaction code, source/destination and transaction-type indexes

The focused EXPLAIN test explicitly confirms an indexed `range` plan for numeric prefixes; public IDs are not cast to strings for LIKE.

## Financial safety

Reuses `adjustUserBalance` and the existing ledger, not transfers or a parallel balance system. Transaction locks canonical owner, checks keyed prior operation, locks selected asset wallet, validates expected current balance/nonnegative safe whole-number result, inserts one completed ledger entry, updates available balance and inserts one audit log before commit. Reserved balances are not altered. Platform recipients must already own a supported wallet.

The four existing types remain `MASTER_COIN_CREDIT`, `MASTER_COIN_DEBIT`, `MASTER_DIAMOND_CREDIT`, `MASTER_DIAMOND_DEBIT`. Audit/metadata include stable target ID/type/role, public-ID snapshot, actor Master, amount/direction, before/after, reason, server timestamp and transaction ID. Existing clients omitting ownerType remain application-wallet requests, including retries of old stored requests.

Confirmation uses a native modal with name, public ID, role, status, asset/action, amount and current/new balance. Debit styling is explicit. In-flight UI guard plus globally unique DB idempotency protects repeat clicks; interrupted/5xx replies retain the same request key for safe retry. A changed balance requires fresh selection/confirmation. Successful replies immediately update the card/result balances and refresh server-rendered history.

History can be filtered by current/snapshotted public ID, Host ID, transaction UUID or transaction code; paginated newest-first; UTC/server storage unchanged with explicit Asia/Kolkata/IST display.

## Executed verification

- Focused fixture integration with all 111 existing migrations: PASS.
- Original Master finance tests including concurrent/stale/overdraw, reserved balances and seven unauthorized roles: PASS.
- New allocation fixture: 26 similar public IDs; normal/Host/Agency-associated/independent/suspended/platform IDs; case/space/leading-zero normalization; exact before prefix; 20+6 pagination for public and external Host prefixes with no duplicates/missing accounts; wildcard input literal; identical display names distinguish by ID: PASS.
- All four operations on app and platform wallets; 20 concurrent same-key requests once; negative/overdraw/stale/key-payload rejects; forced audit-write failure rolls back both balance and ledger; searchable target/transaction history; IST conversion; index plan: PASS.
- Optimized-build direct HTTP: anonymous401, all seven non-Master roles403 for search/writes, cross-origin403, unconfirmed400, no-store/privacy, page limits/concurrent searches, 20 parallel POST retries once, changed payload409: PASS.
- Browser UI against disposable local database, through loopback-only QA proxy: +100 Coins, -50 Coins, +100 Diamonds, -50 Diamonds. Final fixture balances **1,100 Coins / 100 Diamonds**. DB independently confirmed **four ledger entries and four audit records** for these UI actions. Current/new preview, modal, debit warning, selected-card refresh, history: PASS.
- `npm run test:roles`, `npm run typecheck`, scoped ESLint, `npm run build`, `git diff --check`: PASS.
- No real production wallet adjustments were performed for testing.

## Production deployment

**Deployed to production:** main implementation `c4d8ab9f58795f419ed3f168cf0c67a7e35e61d4`, final compact/accessibility label correction `252226aec0e2e95889c43b828f82a26e9b153cc4`. Browser access was restored and the existing authenticated Hostinger Web console used; no new credential/access/firewall change was needed.

Fresh encrypted private OCI predeploy backup verified: `nazraa-predeploy-20261021T141247Z`, **5,675,008,755 bytes**. All eight scoped runtime files passed pre-change guards against baseline `cd08af8f2dfb048e352c39239a498aac5e11bd62` and post-deployment SHA-256 verification against the committed patch. Only the API container was rebuilt/recreated; API health is **healthy**, public config HTTP200, anonymous allocation search HTTP401.

Deployment helper returned `ALLOCATION_DEPLOY_PASS`. Before/after checks confirmed unchanged settings digest, foreign-key inventory and all **111 migrations**, latest `0109_host_auto_resume.sql`. No migrations/config writes, mobile changes, real wallet adjustments, media/realtime/worker/Redis/MySQL restarts were performed.

Rollback retained:

- API image: `nazraa-api:master-allocation-20261021-rollback`
- Source: `/opt/nazraa/backups/master-allocation-20261021-source-1792592372.tar.gz`
- Deployment record: `/opt/nazraa/tools/master-allocation-20261021-deployed.json`
- Log: `/opt/nazraa/logs/master-allocation-20261021-deploy.log`
- One-file label follow-up rollback: `nazraa-api:master-allocation-20261021-label-rollback`; `/opt/nazraa/backups/master-allocation-20261021-label-source-1792592803.tar.gz`.
- Final combined eight-file verification: `/opt/nazraa/tools/master-allocation-20261021-final.json`.

Read-only production DB preflight confirmed a `range` plan using `uq_application_user_public_id` and existing normal/inactive users, Agency Hosts, independent Hosts, active Admin wallets and suspended Admin wallets. These are real existing account categories, not production test fixtures.

Authenticated production browser verification:

- Whitespace-normalized exact Agency Host ID `12000006`: correct App wallet, Agency and active status; Select opens asset/action/amount/reason controls.
- Normal user `12000751`: `USER / INACTIVE`, not a misleading not-found.
- Independent Host `12000000`: correct Host App wallet.
- Platform Admin `358705`: distinct `ADMIN / Platform wallet / ACTIVE`.
- Suspended platform Admin `374433`: visible `SUSPENDED` status.
- Prefix `1200`: 20 initial cards, Show more expands to **40 unique cards**; no duplicate IDs/wallets.
- Rapid successive inputs `12000006 → 358705 → 12000751`: only the latest one-account result remains.
- History User ID `12000015`: two real matching legacy records, no other target; transaction code filter returns exactly its one matching legacy record. Existing reasons/internal notes/before-after balances and IST timestamps remain intact.
- Final visible button reads simply **Select**, while accessible name retains exact target ID and wallet type.
- Real production balances were not adjusted for QA. All four write operations, duplicate requests, overdrafts and forced-failure rollback were executed only against disposable local fixtures. The local QA server/proxy, temporary DB user and fixture database were cleaned up.

**Remaining blocker: none.** No mobile code changed or APK rebuild required.

## Screenshots

- `prefix-search-qa.png`
- `confirmation-qa.png`
- `debit-modal-qa.png`
- `balance-updated-qa.png`
- `allocation-live.png` — deployed interface and actual platform-wallet result.
- `deployment-health-live.png` — guarded deployment/source/config/schema/health evidence.

Live/media, games, gifting, rewards, payout rules, ordinary Coin transfers and unrelated Control sections are outside this change.
