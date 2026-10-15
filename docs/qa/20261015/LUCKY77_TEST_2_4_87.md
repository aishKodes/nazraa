# Lucky 77 test APK — 2.4.87+7399

Owner scope: investigate simultaneous wins in the supplied video, refine Lucky
77 presentation, repair delayed public result history, and supply a signed APK
for testing. No new financial rules, media changes or stable rollout.

## Multiple selections versus multiple winners

`luck77-newreference.mp4` was inspected again, including 48.2–51.2 seconds
frame-by-frame. Rules 6–7 say that when 77 wins, an additional Plum,
Watermelon, both, or neither may be awarded. Therefore that reference can
produce multiple winning areas in a special-77 round.

Nazraa currently has one authoritative winning area. It accepts all seven
nonempty subsets of its three areas, with repeated stakes accumulating on an
area. All stakes on the winning area qualify; funding a second area does not
make it a second winner. The canonical special-bonus flag remains false.

The video supplies no bonus probability table or complete extra-award payout
protocol. No guessed bonus odds, RTP, fees, wallet behavior or payout ratios
were introduced. Existing base and configured settlement adjustments remain
unchanged. In-game Help explains this distinction.

## History root causes and repair

1. The old RESULT route captured a static list. Parent game updates did not
   refresh a sheet that was already open.
2. Public history visibility was coupled to animation completion. An open
   modal can mute the covered game's ticker, leaving committed outcomes
   waiting for an animation that could not complete.
3. SETTLEMENT notices did not trigger the missing-result/private-settlement
   reconciliation. A missed phase envelope could wait for the 20-second
   safety reconciliation, even with the socket nominally connected.
4. Exact-APK observation exposed a separate production cause: round numbers
   use epoch time divided by configured round duration. Pacing had changed
   from 13 to 15 seconds; historical numbers around 137603891 were therefore
   larger than current numbers around 119471983. Both SQL and the mobile
   bounded cache sorted by number, permanently displacing current outcomes.

Lucky-only SQL now orders by the server draw boundary, not display number.
The mobile cache orders by authoritative `settledAt`; incoming Lucky round
transitions use server deadlines. Other games retain their existing ordering.
Migration 0104 adds an online secondary timeline index, without changing any
financial/result rows. A disposable regression inserts an old huge-numbered
result and confirms it cannot displace the real latest 20.

Public committed results now have a separate bounded notifier. RESULT reads
it directly, showing newest-first unique round IDs (maximum 20), independent
of wheel animation. The visible board strip still waits for the authoritative
landing so it does not disclose the outcome before the reveal finishes.

SETTLEMENT reconciles missing public results and this player's outstanding
settlements, including after the next round begins. Repeated irrelevant
notices do not repeatedly fetch private state. Snapshot requests coalesce;
one bounded phase-boundary recovery handles a missed envelope. Three bounded
private-settlement retries cover result/settlement timing. No per-second SQL
polling was introduced. Reconnect and foreground resume reconcile an open
sheet even when its underlying game ticker is muted.

Cache survives an older/partial snapshot, deduplicates by round ID/version,
and never adds an unresolved round. Personal bet history is lazy, fetched
only on expansion rather than blocking the public result list.

## Presentation

Larger readable recent fruit icons; clearly highlighted latest result; a
responsive 20-result grid with round numbers and explicit refresh/close;
pink-purple 77 wedge; subtle gold wheel rim/studs; explicit phase in the hub.
Owned static art is isolated in a repaint boundary while the wheel rotates.
Existing betting controls, responsive sizing, remote chip denominations and
75-ms lossless rapid-bet batching remain intact.

The prior local Princess compact/reveal improvements are retained in this
working-tree APK. No further Princess changes were made during this pass.
Teen Patti Pro source and golden checksums, Home and Profile goldens, media,
Party and payout paths are unchanged.

## Automated validation

- Final `flutter analyze --no-pub`: clean.
- Final full Flutter suite: **343 passed**.
- Lucky authority suite: **31 passed**, including all seven selection sets,
  exact nine-sector targets, 20 rapid taps, immutable retry, late settlement,
  next-round payout recovery without a stale winning overlay, 30 rounds,
  open RESULT updates with ticker paused, missed envelope recovery,
  reconnect/resume, 20 unique results across stale snapshots, lazy private
  history, and 320/390-pixel layouts at 130% font size.
- Lucky board/history goldens inspected and updated deliberately; unrelated
  baselines preserved.
- Disposable local MySQL repository test: 30 forced-time rounds, 48
  settlements (39 winning / 9 losing), all seven selection combinations,
  zero duplicate debits, zero duplicate settlements, zero missing histories.
  Canonical financial paths ran; no production balance mutations were used.

## Backend deployment

The owner renewed Hostinger access. The tested sparse/zero-map retry fix from
`564063c` and Lucky-only chronological history fix were deployed additively
through the existing authenticated maintenance console. No pull/reset.

- Fresh encrypted OCI backup verified: `nazraa-nightly-20261015T153704Z`,
  4,927,503,017 bytes.
- Rollback: `/opt/nazraa/backups/lucky87-retry`, source and Compose snapshots;
  image `nazraa-api:rollback-before-lucky87-retry`. No production data restore
  is needed for code rollback. The additive index can remain harmlessly.
- Exact prior `mobile-product.ts` SHA-256
  `744f65263309871f27b6ebe85f05f26e9dc8fecc44587f84355bb1677406cbc5` guarded.
  New source `d7be96ee71056c4ff8f68dce7028d6a04af25d6e60c576afa31d900ecf80a469`.
- Migration `0104_game_result_timeline_index.sql` recorded; online
  `ALGORITHM=INPLACE, LOCK=NONE`, short metadata-lock wait limit. No wallet,
  result, settlement or rate rewrites. Local/server migration hash both
  `d0da93f43fcc2c68d13703c07963674e054dcfb61f49c64b7910e14aba5a25b3`.
- Current Lucky table has about 99,040 rows. The exact chronological result
  SELECT took 387.59 / 395.32 / 423.70 ms before indexing (three samples).
  Ten after-index samples ranged 0.527–1.464 ms; the query plan uses
  `idx_shared_game_result_time`. These are SQL query measurements, not full
  phone/network latency or statistically established before p95.
- API-only build/restart passed. Internal readiness 200 `ready`, container
  healthy, compiled timestamp-order string verified. Realtime, worker,
  Caddy, MySQL, Redis and external LiveKit services were not restarted.

## Distribution boundary

This is an owner-requested test APK/prerelease, not a replacement for the
stable website build. Stable latest 2.4.86+7398 and minimum 2.1.0 remain
unchanged. No DNS, rate, media or remote-version configuration changes.

## Exact signed APK verification

- APK `Nazraa-Live-2.4.87-7399-test.apk`: 225,345,174 bytes; SHA-256
  `c108cf0ca9407544cde7ab7b998ca9af96d488aef5cc3150afddede3f1bc7a09`.
- Package `com.nazraa.live`, version 2.4.87 / 7399, SDK 36; permanent signing
  certificate SHA-256 unchanged:
  `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.
- Final artifact installed on the Android 16 emulator. Home and Game Center
  opened with the existing normal account. Lucky showed the current shared
  round, configured chips, visible wheel/result and recent outcomes.
- RESULT remained open, with **no refresh, close or bet taps during the
  observation**. Latest visible result advanced from 119471986 (Kala Jam) to
  119471987 (Tarbooj) to 119471988 (Tarbooj), preserving exactly 20 unique
  newest-first results. Three screenshots and timestamped accessibility
  observations are retained with this report. No overflow/uncaught Flutter
  exception was found in the final runtime log scan.
- Earlier exploratory navigation encountered a stale UIAutomator dump; a
  500-Coin selection was observed on the authenticated QA account. No
  administrative balance reversal was performed. The navigation helper now
  rejects a failed fresh dump instead of using old XML. All payout/idempotency
  assertions used the isolated database, not that live observation.
- An initial unpublished draft artifact failed the real timestamp-history
  check. It was replaced before publication; only the hash above is released.
- Download: GitHub prerelease `v2.4.87-qa`; not marked latest. No AAB or force
  upgrade was requested/produced for this owner test build.
