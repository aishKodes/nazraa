# Four-control beauty mapping — 2026-10-17

Extended the existing 18 Master calibrations with four bounded curve exponents
and six bounded cross-channel weights. Authenticated Master Settings only,
reason-required, transactional save/audit. Numeric JSON only; no remote shader
code. Old open forms preserve existing curves; old APKs keep legacy aliases.
Both media-policy response branches expose the same canonical publicMapping.

Validation: TypeScript, changed-file ESLint, beauty policy allowlist/bounds/
finite/default/backwards-compatibility tests and full isolated core-mobile DB
suite passed. No production database migrations or financial mutations.

Deployed only four exact-hash-verified files to the existing VPS API image:
beauty-policy, media-product-actions, Settings, mobile-completion. Source
baseline hashes verified before patch, new hashes verified afterward. Source
and previous running image preserved under:

`/opt/nazraa/backups/beauty-four-controls-20261017/`

Rollback image: `nazraa-api:rollback-beauty-four-controls-20261017`.
Internal API health ready after activation. Canonical key/value environment
digest unchanged. Realtime, worker, Caddy, MySQL and Redis container IDs unchanged.
OCI/LiveKit was not accessed/restarted. No policy/economy/media setting writes.
The verified public `/release/latest` JSON is byte-value-identical to baseline:
**2.4.93** remains public. No testing APK upload/GitHub release/version promotion.

Mobile signed testing build is 2.4.95+7407; local source documentation contains
the exact four-channel formula, shader changes, presets, tests and limitations.
Physical real-human lighting/movement/FPS certification is not claimed.
