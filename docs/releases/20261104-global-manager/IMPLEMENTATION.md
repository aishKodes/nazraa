# Global Manager and Target RTP controls — 2026-11-04

Backend/Control only. Mobile remains **2.5.18+7430**; no APK rebuild, game visual change, media deployment or economy-setting change is required. Production deployment results are recorded separately in the release evidence directory.

## Delegation and scope

`GLOBAL_MANAGER` is reusable, with Master as parent. Existing Country Managers can remain under Master or be assigned beneath a Global Manager; existing lower-role links remain intact. BD supports the requested Admin parent while retaining existing Super Admin mappings.

The exact 18-section Global Manager menu is: Overview; Hierarchy Team; Users; Hosts; Agencies; Wallet & Coins; Coin Orders & Transactions; Coin Transfer History; Withdrawals & Payouts; Monitoring; Live Rooms; Verification; Risks & Restrictions; Support & Reports; Agency Reports; Hiring Reports; Live Reports; Games Management (last).

Master's Global Managers page links an existing active Nazraa account, uses the existing Control credential workflow, and manages status, direct countries, country groups, Country Managers and scoped game-report permission. No real production manager is assigned without the owner identifying the intended account. Economy edits, currency minting and settings remain Master-only.

Read and mutation authorization uses the intersection of current country membership AND subordinate hierarchy. Queries, search, APIs, XLSX/CSV, reports, private document access, wallet counterparties and payouts apply this boundary. A Global Manager cannot claim another Global Manager's Country Manager. Child CS and Coin Seller accounts inherit the managing Global Manager boundary, preventing alternate-login escape through their legacy broad lookup permissions. Roles outside a Global Manager branch retain their existing behavior. Master remains global.

Gift/Banner/Level management, notifications, settings, audit and economy routes are excluded and denied server-side. Game reports may be disabled by Master; platform game-economy editing is never delegated.

## Country model and migration

`0117_global_manager_country_groups.sql` adds normalized management countries, groups, group memberships, direct-country/group assignments, and assignment version/game-report preference. Existing canonical ISO codes are reused, with missing requested countries added. The role ENUM appends GLOBAL_MANAGER, retaining old ENUM order/values. There is no balance, payout, game-setting, user or parent migration.

Middle East contains exactly: SA, AE, QA, KW, BH, OM, YE, IQ, IR, JO, LB, SY, PS, IL, TR, EG, CY. UAE/Dubai resolves to AE. Group changes affect scope at the next request; memberships are not copied to each manager. The seed only inserts initial memberships on first creation, so migration replay cannot undo a later owner removal. Thirty canonical management countries are currently selectable, not an assertion of a complete world-country catalog.

Assignments/group changes are optimistic-versioned, transactional, Master-only and reason/audit protected. Inactive groups grant no country access while retaining assignment history.

## Game Management findings and changes

The old editor primarily exposed unrelated raw coefficients; most games had no target-to-parameter calculator. Uncontrolled form defaults could remain stale after publication. A broad maximum-bet × return ceiling also rejected otherwise legitimate edits against the existing 1.25-billion settlement safety ceiling, and generic errors concealed that validation failure. A 100k-deal simulation shared the mutation action queue.

Target RTP is now the primary reactive control. A shared pure calculator drives immediate theoretical RTP/house-edge preview; the backend repeats it against the locked authoritative configuration. The form provides availability, supported betting chips, min/max bet, payout ceiling, plus existing supported Princess liability/Big Win controls. It computes a safe chip-aligned maximum bet when required, and explicitly previews any reduction; it does not relax the settlement ceiling. Existing outcome probabilities and separate Pro Crown scale are preserved.

Preview is required, followed by reason and confirmation. Stale drafts/versions are rejected. Publication reuses the existing immutable game-config history, increments the version and affects future rounds only. Existing round config and committed result stay byte-for-byte unchanged. Successful save shows active version, target and future-round status immediately. Current/Today/7-day/30-day settled statistics include wager, payout, sample size and house result. Short-term observed RTP never controls outcomes.

The new ordinary editor does not run expensive simulations in its save queue. CLI simulation/verifier tooling remains available.

## Mathematical scope and limitations

- **Princess V7:** exact fixed per-chair expected return before whole-Coin flooring, using the existing disclosed bet-independent weighted-deal model and 5% fee. Not a uniform-shuffle claim.
- **Pro:** target covers normal lanes only. Crown retains its separate configuration; no full-game RTP guarantee is claimed.
- **Lucky 77, Greedy Lion, ordinary Greedy King, Bounty Football:** solve the canonical equal single-area stake-average model for payout scale. Fee thresholds, multi-selection mix, rounding and caps can alter realized returns. Current weights remain fixed.
- **Lion vs Tiger:** protected fixed 2×/30×/2× model, only 30/31 = 96.774194%.
- **Jungle Hunt:** protected, no verified scalar adapter for overlapping/capped paylines.
- **Greedy King with stateful Salad/Pizza specials:** protected until a verified pool model exists.

Unsupported/unreachable targets return `TARGET NOT ACHIEVABLE WITH CURRENT PAYOUT MODEL`, with a valid range/closest target where calculable. Backend per-game policy provides default 50–99% bounds; protected games retain narrower rules. No calculator accepts user identity, wager distribution or observed-RTP inputs. No current production RTP is changed by deployment.

## Verification

- TypeScript typecheck, role matrix, focused ESLint and Next production build: PASS.
- Isolated MySQL fixture: Team A/B in different groups plus same-country foreign-team and wrong-country same-team records; reciprocal visibility isolation, direct search/API and actual parsed XLSX/CSV exports; CS/Coin Seller inheritance; payout read scope and idempotent one-time Diamond debit; foreign owner link/mint/escalation denial: PASS.
- Exactly 17 Middle East members, group removal/restore, Master game-report permission off/on, assignment audit and migration replay safety: PASS.
- Exact built Next application: 20 authenticated Control routes, exact 18-section menu, forbidden-route/API denial, stale/forged JWT role cannot override current DB role, payout mutation denial: PASS.
- Six configurable models: targets 80/90/95%; mathematical error <0.001 percentage point; invalid targets/chips rejected. Each actual shared-round engine previewed/published 80%, retained active config/result unchanged, adopted the version on the next round, rejected stale publication and wrote one immutable version record: PASS.
- 100,000 samples per supported model at 80%: Princess 79.9224%, Lucky 77 80.1324%, Lion 79.7677%, ordinary King 79.9499%, Football 76.7307%, Pro normal lanes 79.7519%. Football has high variance (standard error 1.5198 percentage points); all samples lie within the predeclared six-standard-error check. These are model simulations, not production wallet traffic or exact uniform multi-bet RTP guarantees. Princess uses actual 52-card weighted deals.
- Browser QA: normal Master/Global Manager login, group editor, exact menu and 80→90 target preview/save; UI displayed v2/90% without manual refresh. This changed isolated QA data only. Screenshots are explicitly QA.

The broad legacy integration command stops at a pre-existing obsolete monthly-Diamond-reset expectation (`completed` expected, `rankings_period_only` actual). The production policy intentionally preserves balances. It was not changed to satisfy the old assertion, and a full legacy-suite pass is not claimed.

## Main files

- RBAC/hierarchy/scope: `types/platform.ts`, `lib/auth/*`, `lib/db/repositories/accounts.ts` and existing scoped repositories/API routes.
- Master groups/assignments: `lib/db/repositories/global-management.ts`, `app/dashboard/global-managers/*`, `components/shell.tsx`.
- Target adapters: `lib/games/target-rtp.ts`, `economy-model.ts`, `princess-paytable.ts`, `economy-policy.ts`, `game-config.ts`.
- Existing economy publication/report reuse: `lib/db/repositories/game-economy.ts`, `app/dashboard/game-management/economy/*`.
- Durable round version metadata: `lib/db/repositories/mobile-product.ts` (metadata only).
- Tests: `scripts/verify-global-management.ts`, `verify-global-management-http.ts`, `verify-target-rtp-controls.ts`, `verify-target-rtp-rounds.ts`, updated `verify-role-matrix.ts`.

## Deployment and rollback rule

Deploy only the scoped patch over verified 7e3a0e3 source hashes. Capture protected settings/role-link digests and every existing container identity, require a recent verified offsite backup, retain source and image rollback, build the API, apply only additive migration 0117, recreate API only, then verify health and unchanged protected settings/non-API containers. Leave additive schema in place on image rollback; do not destructively remove future manager assignments. Current APK/minimum version and all game configs remain unchanged.
