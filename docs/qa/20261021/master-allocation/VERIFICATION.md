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

Encrypted private OCI predeploy backup verified: `nazraa-predeploy-20261021T104229Z`, 5,648,772,184 bytes. Guarded API-only helper is prepared to compare every existing source hash to baseline `cd08af8f2dfb048e352c39239a498aac5e11bd62`, archive source, retain API rollback image, roll back on failure, and compare config/schema/FK inventory before/after.

**Deployment not yet performed.** After the backup completed, the browser-control tool began returning “Local browser use is disabled in Work settings.” A fresh official SSH attempt with the existing key also timed out during banner exchange. No patch capsule was transmitted/applied and the existing production API is unchanged. Re-enable local browser access to resume the authenticated Hostinger Web console. No password, new infrastructure or database migration is required.

## Screenshots

- `prefix-search-qa.png`
- `confirmation-qa.png`
- `debit-modal-qa.png`
- `balance-updated-qa.png`

Live/media, games, gifting, rewards, payout rules, ordinary Coin transfers and unrelated Control sections are outside this change.
