# Owner Party / PK / gifting update — staging only

Date: 2026-11-02, Asia/Kolkata. Candidate: **2.5.08+7420**.

Production baseline remains 2.5.07+7419. No production deployment, database
migration, balance edit, remote activation, website upload or GitHub release
was performed for this task. Explicit owner approval is required for release.

## Rollback and scope

Source baselines: mobile `1f2677345c35`; backend `5094fa2`.
Both checkouts use `codex/party-face-gifting-staging-20261102`.
Before-change patches and complete Git bundles are in the protected local
`/Users/aishwaryam/nazraa-release-evidence/20261102-staging/` directory.
Existing unrelated backend changes were preserved separately and not committed.

No LiveKit routing, publishing, permission grants, economy games, payout,
Agency or Host Live reward rules were replaced. The new Face PK frame wraps
existing media children; the existing PK countdown remains the authority.

## Gifting: one settlement path

All normal room gifts pass through `mobile-product.sendGift`, then the same
`sendGiftToRecipient` transaction. The source audit found one production
`GIFT_RECEIVE` insert path. Party, Face, Party PK, Face PK, SINGLE and ALL
therefore share the same prospective policy and frozen batch timestamp.

Canonical setting: `mobile.gift_economy`:

- `giftPlatformFeeBps: 1500`
- `platformFeeActivatedAt: <approved UTC timestamp>`
- Existing legacy conversion settings remain available before activation.

The backend uses integer/BigInt arithmetic:
`net = floor(gross * 8500 / 10000)`; `fee = gross - net`.
No frontend fee calculation or client-provided price is trusted. A one-Coin Gift settles as net zero / fee one; its zero-net snapshot is retained in the event and debit/fee audit, without inserting an invalid zero-amount credit ledger row.

| Context | Sender before | Gross debit | Sender after | Net Diamonds | Fee |
|---|---:|---:|---:|---:|---:|
| Party | 1,000 | 100 | 900 | 85 | 15 |
| Face | 1,000 | 100 | 900 | 85 | 15 |
| Party PK | 1,000 | 100 | 900 | 85 | 15 |
| Face PK | 1,000 | 100 | 900 | 85 | 15 |
| Party ALL, four occupied recipients | 1,000 | 400 | 600 | 340 | 60 |

Every single settlement has one `GIFT_SPEND` (100 Coins), one `GIFT_RECEIVE`
(85 Diamonds) and one accounting-only `GIFT_PLATFORM_FEE` (15). The fee row
never debits another wallet. Event and ledger metadata retain transaction,
batch, sender/recipient, room/session, quantity, gross/net/fee, basis points,
policy version, status and server timestamp. Six concurrent identical requests
settle once. Conflicting reuse of an ID is rejected. Insufficient funds and an
injected ledger storage failure roll back the entire batch.

A duplicate-key reservation now takes an exclusive lock immediately; the old
INSERT IGNORE / lock-upgrade sequence deadlocked under simultaneous retries.
Historical gift snapshots are immutable: a legacy 97-Diamond event remains 97
after activation and migration replay. No historical balance is recomputed.

Face PK keeps its existing **gross Coins** score. Audio PK keeps its existing
**net Diamonds** team score. Per-seat Diamond totals are aggregated by actual
recipient User ID within the PK interval; mute has no effect, and a new seat
occupant inherits zero of the previous user's total.

## Party UI

ALL uses currently occupied eligible seats, excludes audience/empty/departed
members, and retains individual targeting. The UI shows recipient count,
per-gift Coins and total gross cost, with Coins balance below Send. Actual
server totals and message are used after settlement. A Host without an assigned
regular seat is individually giftable but not invented as an occupied ALL seat.

Inbox was restored in the existing Room tools sheet and opens MessagesScreen.
No second inbox, history store or payment loop was introduced.

## Monthly accounting

Current rankings use UTC interval bounds for the Asia/Kolkata calendar.
October ends at 2026-10-31 18:30:00 UTC; November starts at that exact instant.
Sending uses gross spend, receiving uses net credited Diamonds. Live History
summary is current-month; its dated historical rows remain pageable and retain
legacy gross `receivedCoins` alongside explicit `receivedDiamonds`.

The old monthly earnings reset routine could zero Host Diamond wallets.
It is now a reporting-only compatibility no-op: zero affected users and zero
expired amount. Old reset audits, payout history, rewards and wallet funds stay
intact. Repeated rollover calls never change a wallet.

## Random PK reward

This updates the existing Face PK streak campaign (`live_pk_sessions`), rather
than adding a new reward economy to Audio PK. Only mode Random qualifies;
Friend and Classic do not advance or reset progress. Existing loss/draw and
5,000 gross gifting eligibility semantics are preserved. Three qualifying wins
create a 5,000-Coin **claimable** record; completion never credits the wallet.

The backend verifies the battle's server deadline before completing this new
campaign, and freezes scores at that deadline. A client cannot finish early to
create a reward. Claim locks the owner's claim and wallet, writes one uniquely
keyed credit and marks Claimed atomically. Eight parallel claims create one
5,000 credit; foreign-account claims fail. Completed session retries do not
create another reward. A new campaign cycle starts prospectively; unclassifiable
legacy all-mode streak progress is not copied. Old paid bonuses/history remain.

Rollout fence: `mobile.owner_party_pk_update.activatedAt`. The same bundle hides
only daily check-in Coin tasks; Live rewards and other claims remain accessible.
Existing check-in history is retained. The existing Live-hour reward currency,
amount, eligibility, periods and claim rules were not changed.

## Face PK presentation and isolation

Local room Host identity determines left/red; opponent is right/blue. Viewers
use their room Host perspective. Scores and canonical ownership are not swapped
in persistence. Repeated reconciliation and stale perspective flags are tested.

Compact headers show DP/name, separate room viewer counts, gross PK gift value,
profile link and Follow targeting canonical IDs. Thin 5px score bar and original
timer sit above taller portrait media. Portrait containment preserves source
aspect ratio and top/head visibility. Existing Chat/Gifts/Games/mic/tools remain.

Only two local guest slots are shown. The existing subscribe-only opposing
bridge subscribes only to that Host's camera/mic, not opposite guest tracks.
Guest publishing permissions remain local-room scoped. No opposing guest profile
or seat payload is rendered. Profile navigation and score/timer updates preserve
the same media child State objects. PK cleanup preserves normal room publishing.

Audio PK's narrow center VS/timer now scales down instead of wrapping across
lines. Its two affected Audio PK goldens were visually inspected and updated intentionally;
Home, Profile and game goldens were not updated.

## Migrations and activation (not executed on production)

`0112_owner_gifting_random_pk.sql` is additive and restart-safe. It adds Gift
fee/batch/context snapshots, new Random-only streak columns, policy event
version and uniquely keyed `pk_reward_claims`. FK column collations match the
existing parent tables. It does not activate configuration or rewrite old rows.

After approval, back up the real database and deploy the complete backend and
mobile candidate together. Apply 0112 before new code serves financial writes.
Verify all backend replicas contain the new central settlement path. Set both
canonical activation timestamps together in one audited Master configuration
transaction, using one future UTC instant. Do not activate one runtime/path
while any old backend is serving writes. All clients receive server outcomes.
Never roll back by changing historical gift, reward or wallet records. Any
emergency policy change applies only prospectively and must be audited.

## Reproducible staging validation

From the backend checkout:

```
NAZRAA_QA_ONLY_OWNER_UPDATE=1 npm run test:core-mobile
npm run typecheck
npm run test:core-mobile
npm run test:roles
```

The focused suite refuses any database not named `nazraa_mobile_qa_*`; the core
harness creates and drops that disposable localhost DB. `NAZRAA_QA_KEEP=1`
retains only synthetic fixtures for the emulator. The local HTTP harness is
`scripts/owner-party-pk-http-tests.mjs`, bound to localhost:3998 and those
synthetic sessions. It verifies authenticated ALL/retry settlement, unauthorized
and foreign-claim denial, claim replay, check-in visibility and PK identities.

The real WebRTC transport harness is `scripts/owner-face-pk-media-qa.mjs`.
It only targets ws://127.0.0.1:7880. Installed local LiveKit 1.13.7 and the
isolated official rtc-node package carry generated audio frames across two Host
rooms plus local guests and opposing Host-only bridges. Decoded audio proves
Host-to-Host transport, same-room guest audibility and no opposing guest audio.
Bridge reconnect, audience join and bridge-only cleanup preserve base tracks.
All synthetic media rooms are deleted after the test.

From the mobile checkout:

```
flutter analyze
flutter test
flutter test --dart-define=NAZRAA_CAPTURE_STAGING=true test/owner_party_pk_staging_test.dart
```

The explicit emulator entry point `tool/owner_party_pk_staging.dart` uses the
real repository and local API. It refuses production or non-loopback API hosts,
uses the existing `.mediaqa` debug identity, and does not replace the user's
production app/session. Its Face pane uses labelled portrait test surfaces;
this is layout evidence, not a claim of an Android two-camera media call.

## Evidence and limits

Local logs, screenshots, recording, hashes and source manifest:
`/Users/aishwaryam/nazraa-release-evidence/20261102-staging/`.

- Database tests: all four gift contexts; Party ALL 400/340/60; Face ALL;
  six-request retries, atomic rollback, seat replacement, IST boundary,
  preserved old transactions, migration replay, Random-only claim security.
- HTTP tests: five concurrent ALL retries settle once at 200/170/30;
  authentication, foreign claim denial, claimed replay and visibility parity.
- Flutter: responsive 320/390/430px layouts at 100%/160% text, canonical profile
  and Follow IDs, media-State preservation, Inbox navigation, claim busy/claimed
  state, ALL selection and per-seat recipient identity.
- Backend full regression and role matrix cover existing economy/media authority,
  games, payout, Agency and reward behavior.

No physical two-phone camera/forehead or WAN/weak-network quality measurement
was performed in this task. Local decoded-audio proof and renderer lifecycle
checks do not certify real-device media quality. No production balance or
infrastructure was used to manufacture a pass. Owner release approval remains
required before publishing or activating this candidate.
