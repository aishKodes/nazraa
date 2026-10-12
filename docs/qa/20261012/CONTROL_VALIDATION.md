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

## Production verification pending until deploy

Candidate runtime health/config check, Master banner save, role-scoped pages and
Master withdrawal summary must be checked after deploy. This document is not a
claim that production verification has already passed.
