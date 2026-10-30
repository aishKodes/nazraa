# Country Management and Game Economy — 30 October 2026

## Scope and reuse

Control/backend-only extension. No Flutter change or APK rebuild. Reuses
`platform_accounts.country_code`, `application_users.country_code`, the existing
Country Manager hierarchy and `scopeFor`/`scopeWhere`, wallet balances, rooms,
withdrawal/Host payout snapshots, `mobile.games`, the existing RNG, shared-round
bet/settlement ledger, result history and audit logs. No parallel country,
wallet, payout, commission, or game engine.

Supported country codes added to the existing canonical panel list: **SA**
(Saudi Arabia), **AE** (United Arab Emirates), **NG** (Nigeria), **DZ** (Algeria),
**MA** (Morocco). **NP** (Nepal) already existed and is retained exactly once.
Dubai/UAE/United Arab Emirates normalize to AE; KSA/Saudi normalize to SA at
the country-management boundary. No independent Dubai country. Existing
countries and ownership are preserved; no real manager is fabricated.

## Operator guide — Country Management

1. Sign into the existing Master Control at `https://nazralive.in/login`.
2. Open **Country Management** in the Core navigation.
3. Leave **All countries** selected for global totals, or select an ISO country.
4. Review users/Hosts, Agencies/Admins, assigned managers, active Face/Party
   rooms, available Coin/Diamond balances and withdrawal snapshot activity.
5. Create a Country Manager through **Team** using the existing role, then
   assign it in **Country Management → Assign / change Country Manager**.
   Enter a reason. An occupied branch cannot be reclassified to another
   country here; use existing Hierarchy reassignment first.
6. Open the country record for its team, recent users/Hosts and active rooms.
   Lists explicitly state their bounds. Monitor links to the existing user-ID
   search and Device Block/Unblock workflow; it uses the same device database.
7. Country Managers see only their canonical country and existing authorized
   hierarchy branch. Direct cross-country API/URL changes are denied.

No operational country activation flag existed, so none was invented. Targets
remain explicitly not configured, matching the existing report. Withdrawals
use immutable historical USD snapshots; absent historical values are not
recomputed using today's rate. Team assignment never modifies wallet values,
Agency membership, roles, permission grants or historical country snapshots.

## Operator guide — Game Economy / RTP

1. Sign in as **Master**.
2. Open **Game Management → Game Economy / RTP**.
3. Select a game and **Today (IST)**, **7 days**, **30 days**, or a bounded
   custom IST date range.
4. Review valid settled stakes, net Coin returns, platform net (`stake−return`),
   observed RTP (`net payout/stake`), unique rounds, player-rounds, players,
   average/largest round wager and largest payout. Activity is labeled as
   recent settled activity rather than asserted online presence.
5. Review current mathematical assumptions. The configured target is a
   reporting label, not an RNG dial. Per-area theoretical return and
   equal-area model are disclosed separately. Net payouts include the
   existing fee/scaling/cap semantics; whole-Coin rounding is disclosed.
6. Expand **Edit configuration**. Existing supported controls include
   availability, bet bounds, maximum return multiplier, paytable scale;
   Luck77/Football fixed global outcome weights; Pro Crown scale; King
   Salad/Pizza special weights and existing pool parameters. No per-user
   control or forced winner exists. No country-specific economics.
7. Click **Preview configuration**. Compare current/proposed values,
   calculated model and first-new-round effective condition.
8. Enter a 5–500-character reason, confirm the review checkbox, and click
   **Confirm and publish**. A stale preview is rejected; preview again.
9. Inspect the immutable version history (actor ID, reason, UTC publication
   time displayed in IST, previous and new configuration). No edit/delete UI.
10. Monitor a meaningful sample. Warnings mean **INVESTIGATE**, never alter
    an outcome. The 1,000-round floor is an operational guard, not a formal
    statistical confidence test; selection mix and historical versions matter.

**Protected owner rules:** Princess remains 3.00× gross and 3% service fee;
no arbitrary RTP slider. Its unbiased deck and current hidden/public-card
mode are preserved. Public-card conditional advantage is explicitly disclosed.
Lion Vs Tiger retains 15-second wagering, 2×/30×/2×, three outcomes, fixed
15:1:15 weights and unrestricted stake sizing. No additional unsupported fee.

**Model limits:** Pro's displayed analytic model covers normal lanes only,
not Crown. Jungle's capped multi-payline distribution has no scalar analytic
model here; its existing dedicated RTP verifier remains available. King's
state-dependent special pools intentionally disable the static model when
enabled. The panel never invents a universal theoretical RTP for these cases.
Unsupported absolute exposure caps are not presented as functioning controls.

**Internal simulation:** choose 100,000 or 1,000,000 samples and simulate the
current disclosed single-area distribution. Equal random area selection,
unit stake, variance, largest return and area win counts are reported. No SQL
wallet mutation, real bet, result insertion or production outcome occurs.

## Versioning and financial safety

Migration `0111_game_economy_versions.sql` adds `game_config_versions` and
`config_version/config_json` to the existing shared-round table. It is
resumable on MySQL/MariaDB. Only pending/current metadata is frozen at upgrade;
historical outcomes/results/wallet entries are never rewritten.

Every new round freezes the complete effective runtime configuration and fee.
Bet validation, rendering controls and settlement use that snapshot. A changed
availability or cadence applies after the active round ends. New rounds use
unique monotonic numbers and cannot overlap the preceding round after a
cadence edit. Both Settings and the new workflow use the same version writer.
Economic edits through legacy Settings direct operators to the preview flow.
Existing wallet locks, durable idempotency and settlement uniqueness remain.

MariaDB can return JSON aliases as text while MySQL returns parsed objects.
The old runtime normalizer ignored text settings. Unversioned runtime behavior
is intentionally retained rather than activating unrelated dormant values at
deployment. A deliberately previewed/published game version is parsed on both
formats. Only that game's stored object is replaced. Migration snapshots
preserve the prior effective format; explicit new snapshots carry a marker.
Tests cover both representations. Actual production wire type must be checked
through its server runtime before claiming a live MariaDB result.

## Verification evidence

- `npm run build`, TypeScript and changed-file ESLint.
- Existing role matrix, protected Princess verifier and existing RTP verifier.
- Focused isolated DB: six country branches with real test managers, hierarchy,
  Agencies and Hosts; canonical aliases; country isolation and cross-country
  denial; occupied-branch reassignment denied; Host payout snapshot totals.
- All seven non-Master roles denied preview/publication/global economy reads.
- Accepted Luck77 wager settles once at original v1 after v2 publication;
  changed min bet and scale affect the next round only; immutable outcome,
  dashboard totals match settled net returns; duplicate request/settlement one
  debit/credit; stale preview denied; Princess 3× preserved.
- Direct built HTTP: anonymous 401; Master allowed; Nigeria manager own-country
  200/Morocco 403; all other roles country API denied; economy non-Master 403;
  direct page redirects enforce the same boundaries.
- Browser in disposable localhost QA: preview 1,079,545→1,000,000 scale showed
  95%→88% modeled return; reason/confirmation produced immutable v1 history.
  One-million-round simulation: 87.543% versus 88% theoretical in that run;
  largest 7.92× and variance 2.6838. No production setting changed by QA.
- Full core suite: 30 accelerated rounds per shared game plus existing Live,
  Party, PK, payout, gift, Agency and reward regressions.

Local screenshots in `docs/qa/20261030/` are explicitly QA, not production proof.
Logs reside in `/tmp/nazraa-country-economy-*.log` on the development machine.

## Deployment and rollback

Pending guarded deployment: source-only patch, existing encrypted OCI
pre-deploy backup, additive migration, API-only image replacement. No LiveKit,
Redis, worker, realtime, DNS, mobile version, currency or reward-rule change.
Preserve the dirty production checkout and merge only scoped hunks. Keep the
old image and source archive. Keep additive metadata on rollback; never drop
financial or historical data. After any new economy version is published,
do not start an older unsnapshotted settlement binary against those wagers;
use a forward repair or explicitly compatible rollback.
