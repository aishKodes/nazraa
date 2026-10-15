# Audio PK, Greedy King and Agency Owner payouts — 2.4.88+7400

Scope: compact Party-style Audio PK seats, the owner's new Greedy King video,
Agency Owners' own Host payout association, and downloadable Master payout
lists. No other game, media routing, reward rule, payout rate, or balance was
changed.

## Audio PK

Reuses the actual `RoomSeat` component: avatar/cosmetic styling, seat number,
mute badge, Host badge, name pill and empty sofa. Responsive FittedBox scaling
preserves its aspect ratio. Two Hosts and four smaller seats on each team
remain as before. Canonical seat indexes and identities remain unchanged.
Host seat numbers are hidden rather than inventing a seat assignment.
Known local users retain their existing cosmetic models; unknown remote
summaries do not fabricate levels/VIP. The existing local VAD listenable
drives speaking state; unmuted alone never fabricates speech. Opponent bridge,
publication permissions, seat mutations, scores and timer logic are untouched.

Widget checks cover 320/390/430 widths, invitation/active/result/rematch states,
ten reused seat widgets, two Host badges, sound action and disposal. The new
Audio PK golden was inspected using Nazraa's actual dark theme. This pass is
not a claim of a new real two-Host audio match test.

## New Greedy King reference

Visually inspected `greedykingnew-reference.mp4` (384×850, 103.22 seconds),
including the selector, bets/chips, result stage and rules at 60/101 seconds.
Matched useful presentation principles with original Nazraa artwork: bright
royal garden, eight food houses, animated crowned mascot, separate lower
Salad/Pizza areas, chip markers, sequential pink selector, image history and
bounded curtain-style result stage. Existing chip denominations, item IDs,
food names, multipliers, group semantics, server clocks and settlement remain.

The video shows a six-option limit and 20-second betting instruction. Nazraa's
canonical King supports ten targets and remotely configured timing. These
economy/rule settings were deliberately not silently replaced during a visual
rebuild. No reference-app assets/code were imported.

Original art was generated with the built-in image tool. Prompt specifications
and exact saved asset paths are documented in the mobile workspace at
`assets/games/greedy_king/ARTWORK.md`. The two compressed assets total 623,820
bytes. A single bounded atlas decode is shared by houses/history/results.

Exact-APK recording exposed a real reveal defect: the previous ~4–5-second
traversal could outlast the server result phase. Applying a deferred next
round erased the result in the same frame. King now scales its deterministic
exact-target traversal to the remaining authoritative phase, reserving 1.5
seconds for reveal where available. Late entry skips a stale full traversal.
King history does not reveal the currently travelling target before landing.
Late current-round settlement updates the stage from the authoritative saved
payout. No next-round server deadline or financial state is delayed.

A further production read-only check localized frozen King history to the
same old pacing defect as Lucky: descending number returned September 2
round 105195080 (Hot Dog), while the actual latest October 15 round was
68926376 (Lettuce). King now also orders completed history by authoritative
draw timestamp. The existing timeline index covers this; no migration,
outcome or payout rewrite was required. Other games' ordering is unchanged.
An isolated regression verifies ten newest unique King results despite a
larger obsolete epoch number, alongside the unchanged 30-round Lucky financial
soak (48 settlements, zero duplicate debits/settlements/missing histories).

## Payout routing and exports

New requests resolve the Host's own active Agency first, then membership.
Historical payout-rate/Agency snapshots are not rewritten. No separate Owner
payout row/ledger was invented. The existing atomic Diamond reserve,
idempotency, USD amounts, audit/reversal and commission logic remain intact.

Master Control offers Agency summary CSV and Host payout detail CSV. Current
filters and Agency drill-down scope carry into both downloads. Agency users
can only export their own masked detail; global summary is Master-only.
The former silent 10,000-row export cap is replaced by sequential 250-row
keyset pages under a database-clock cutoff. UTF-8 BOM, quoted text, padded
formula protection, decimal USD, IST timestamps and no-store headers are used.
Private payment destinations are never decrypted into the CSV.

Disposable MySQL/HTTP tests verify: active Owner with stale foreign membership;
own-Agency visibility and foreign denial; unchanged historical snapshots;
254 complete/unique detail rows over multiple pages; exact Agency totals;
Master/Agency authentication, formula escaping, masked destinations, concurrent
idempotent reserve/payment/reversal and existing 10-Host $100/$11 example.

Production read-only audit found zero existing Owner Host payout snapshots,
so there were no historical Owner requests to reassign. No production payout,
bet, balance, configuration or financial table was edited for QA.

## Deployment / rollback

Backend commit `4d689e1e7bbfb89d9a5a91b328e761d25de85ec7` deployed additively
with exact pre-file checksum guards. API only was rebuilt/restarted. Existing
worker, realtime, Caddy, MySQL, Redis and LiveKit were not restarted.

- Fresh encrypted offsite backup verified:
  `nazraa-nightly-20261015T165707Z`, 4,937,410,320 bytes.
- Source/Compose/image rollback: `/opt/nazraa/backups/payout88` and image
  `nazraa-api:rollback-before-payout88`.
- King history follow-up: `082c8d1`; exact source SHA-256
  `95b413d969f19756f08bff97e78609a942d4f8f8b5a88d849c7c9f874807803e`.
  Separate code/image rollback `/opt/nazraa/backups/king88-history` and
  `nazraa-api:rollback-before-king88-history` preserve the deployed payout fix.
- Internal readiness: HTTP 200 `ready`; API healthy; compiled CSV UI present.
- Public unauthenticated CSV: sanitized HTTP 401; Control page redirects to
  login. No existing signed-in Master browser session was available for an
  additional live UI download; authenticated route tests ran in disposable QA.

## Validation / distribution

- Final Flutter analysis: no issues.
- Final full Flutter suite: **360 passed**.
- Backend typecheck, scoped ESLint, production Next build and full core-mobile
  disposable repository/HTTP tests passed.
- King tests: all ten tappable targets at compact sizes; every authoritative
  result image; owned-art goldens; short server result phase stays visible and
  next round opens; existing settlement/no-client-credit checks unchanged.
- Teen Patti Pro and unrelated game/media logic preserved.

This remains an owner test APK/prerelease, not a forced stable rollout. Stable
website latest 2.4.86+7398 and minimum version remain unchanged.

## Exact final APK

- Version 2.4.88 / build 7400; package `com.nazraa.live`; target SDK 36.
- APK `Nazraa-Live-2.4.88-7400-test.apk`, **226,085,183 bytes**.
- SHA-256:
  `9d76a516c86a9e15f86062aa4600fb54aebcf70e2a9474e54a0e4efd795bcb3d`.
- Permanent signer SHA-256 unchanged:
  `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.
- Installed that exact signed artifact on the Android 16 emulator using the
  existing ordinary QA session. Home and Game Center opened normally.
- An initial 38-second read-only King recording confirmed travelling selectors,
  CORN/CARROT result stages and subsequent betting rounds. The final centered
  APK was then cold-started again; installed `base.apk` SHA matched the release
  hash above. A fresh screenshot confirms centered TOMATO result 68926422 and
  the repaired chronological history containing current October results.
  No bet/action taps occurred while observing the game, and the QA Coin balance
  remained unchanged. No Flutter/Android runtime error was found in the sampled
  error logs. One intervening recording was invalidated because external input
  changed tabs; it is not counted as a successful game test.
- Draft exact-APK observation caught the disappearing reveal and atlas-edge
  defects plus result centering; these were corrected and the final artifact
  retested. Earlier draft assets had zero downloads before replacement.
- GitHub test prerelease: `v2.4.88-qa`, not latest. Stable latest remains
  `v2.4.86`; website download still points to 2.4.86+7398. No force upgrade or
  AAB was requested for this test delivery.
- Public release APK downloaded again in full (226,085,183 bytes) and SHA-256
  matched `9d76a516c86a9e15f86062aa4600fb54aebcf70e2a9474e54a0e4efd795bcb3d`.

Test APK:
https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.4.88-qa/Nazraa-Live-2.4.88-7400-test.apk

Master Control:
https://nazralive.in/dashboard/host-payouts

Private local evidence/source snapshot:
`docs/qa/20261015/audio-pk-king-payout/private/` (not committed/uploaded).
