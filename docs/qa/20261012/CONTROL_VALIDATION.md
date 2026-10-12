# Owner-scoped Control update — 12 October 2026

Control changes are separate from mobile/media changes. No database migration,
wallet repricing, reward-rule change, media-provider change, or mobile release is
part of this deployment.

## Completed local validation

- Repository integration: 99 existing migrations, 29 assertion groups.
- Eight-role permission matrix; scoped device block/unblock, private Host fields,
  cross-branch denial, audited Master Agency transfer/removal.
- Direct HTTP checks: permanent moderation remains Master-only; CS Face
  restrictions are exactly 30/120 minutes; CS report reads do not grant exports.
- Master withdrawal export: 31 actual isolated records, 32 XLSX rows including
  headers, matching CSV, no duplicate rows. Artifact import and visual preview
  verified (`withdrawal-detail-preview.png`).
- Ledger stream: 10,005 isolated records for Master/Admin/Super Admin, no duplicate
  rows and no old 10,000-row truncation. CS access denied.
- Withdrawal dates use validated IST calendar boundaries and immutable saved USD
  distribution/hierarchy snapshots. Unsnapshotted amounts are not invented.

## Confirmed production banner defect

An owner-provided 1.3 MB PNG preview succeeded, but saving failed with the runtime
Server Action default 1 MB body limit. The runtime Docker stage omitted
`next.config.ts`, despite its existing 8 MB Server Action limit. Copying the
config into the runtime image fixes the deployment cause. Existing image
integrity/type/2 MB file limit is retained. No artwork redesign is included.

## Explicit data-source limitations

The existing system does not record a separate canonical Party Board count or
assigned Agency activity target. Those fields say not configured rather than
fabricating a business rule. Historical country changes without a saved country
snapshot cannot be reconstructed exactly. Exports over 20,000 withdrawal rows
require narrower filters and return an explicit error, never partial success.

## Production verification

The private candidate runtime reported ready and the configured 8 MB Server
Action limit. The API-only deployment retained the existing worker, realtime,
database, Redis, Caddy, production config and dirty source edits. Master saved
the previously failing 1.3 MB PNG; the stored WebP loaded at 951 × 450. The QA
banner remains disabled. The Master withdrawal summary loaded without a server
exception. Screenshots are retained locally in this directory.

A final export audit also found that the Game workbook's player-summary sheet
used the interactive 100-player limit. It now exports the full authorized
filtered set (with the same explicit 20,000-row safety limit as the detailed
report). Direct HTTP XLSX tests verify 101 actual isolated players and all
history for Master/Admin/Super Admin, alongside the 10,005-ledger-row tests.
Private-contact inference via the Users search is denied for roles without
private Host identity access; tests populate real fixture fields before checking
redaction, instead of merely checking already-null fields.

Operational Face/Party hour projection also uses the same committed/valid-media
seconds as canonical Live History, not a larger legacy room-open duration. An
isolated assertion verifies that 7,200 legacy duration seconds cannot overwrite
1,800 actual committed publishing seconds in the new display.
