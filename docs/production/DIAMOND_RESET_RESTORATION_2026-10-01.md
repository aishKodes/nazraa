# Owner-approved October reset exception — completed

The owner explicitly requested restoring the balances removed earlier today,
not changing Coins/reward economics or permanently removing the monthly rule.

## Exact production result

- Original reset: 2026-10-01 00:00:10 Asia/Kolkata
  (2026-09-30 18:30:10 UTC), reset month `2026-10-01`.
- Original immutable ledger: 648 `HOST_MONTHLY_RESET` records,
  exactly **12,540,127 Diamonds**; no Coin reset records that day.
- Restoration committed at 2026-10-01 02:40:53.963 UTC / 08:10:53.963 IST.
- Exactly 648 `HOST_MONTHLY_RESET_RESTORE` credits, **12,540,127 Diamonds**.
- Original-to-restoration missing/mismatched records: **0**.
- Duplicate restored recipients: **0**.
- Post-commit preview: pending users/amount **0**, already restored users **648**.
- One `wallet.monthly_reset_restore` owner-authorized audit; no Master identity
  was impersonated.

Every original reset deduction was added to that same user's **current**
available Diamond balance in one transaction. No balance snapshot was copied
over newer activity. Coins, reserved balances, later earnings/spending,
claimable rewards, original ledger records and public APK bytes are unchanged.
Per-credit audit metadata records the original reset transaction and the
locked before/after balance; wallet arithmetic was verified before commit.

## No repeat reset this month

The existing `monthly_host_earning_resets` row is retained, not deleted or
rewound. Authenticated production scheduled endpoint verification returned
HTTP 200, `resetMonth=2026-10-01`, `status=already_completed` after restoration.
It cannot reset these restored balances again in October. The future monthly
rule remains unchanged; this reverses only the reset already performed today.

## Safety and backups

Operations source commit `2e12bb7`. No API rebuild/container restart, migration,
mobile rebuild, media/config change or outside financial service was needed.
The copied source-only maintenance script has no credentials; it reads the
existing API container's server-side DB environment without logging values.

Root-only pre-operation backups (directory mode 0700; files 0600):
`/opt/nazraa/backups/production/diamond-restore-20261001/`

- `wallets-before.sql.gz`: `076cd919ecf5d2c0439b98f41a4ec3f6fd6c3af03c145b5232031ac733e36bd1`
- `ledger-before.sql.gz`: `9cb715f38d2bc1b9406357a432293c903fb6faaedc89d6b37169b408cca93313`
- `reset-guards-before.sql.gz`: `5cb51c9baa57fe9d420a4081dcbe4c933ba178cf110ddbdb95edb334223285dd`

All gzip integrity checks passed. Do not restore the complete wallet snapshot
over newer production activity. Any later correction must use separately
authorized compensating ledger transactions, not overwrite balances/history.

## Regression evidence

`node scripts/verify-monthly-diamond-restore.mjs` passed on a disposable local
database using the existing authoritative table definitions. It proves exact
additive compensation, preserved subsequent activity/Coins/reserves, unchanged
original reset history, mismatch rejection, no-credit preview, injected failure
after the first attempted credit with full rollback, concurrent/repeated
once-only crediting, one audit and retained monthly guard. ESLint passed.

The production dry-run matched the previously audited 648 / 12,540,127 scope
before any credit. API health stayed `ready`. Release `2.4.76+7388` and its
published checksum remain unchanged. Users may need to refresh/reopen their
wallet to replace an already-rendered client balance.
