# Princess / Lucky 77 reference pass — 2026-10-15

Scope: only `teen_patti` (Princess) and `luck77`. Baseline public release remains
2.4.86+7398. No production deployment, version update or financial mutation is
part of this implementation/test pass. The Android profile build is a local
working-tree test, not a new distributed release.

## Reference inspection before implementation

- `/Users/aishwaryam/nazra2/new-teenpatti-reference.mp4`: 384×850, 178.959 s.
  Full timeline contact sheets and 7–16 s frame-by-frame reveal inspected.
  Chairs reveal in sequence; each receives a red hand-type ribbon; the winner
  has a strong gold treatment and visible cards; personal WIN is bounded over
  the Princess, with chip flight and a light heart reaction. The 171 s example
  returns 320,100 after a 110,000 winning-chair bet: 330,000 gross minus 9,900.
- `/Users/aishwaryam/nazra2/luck77-newreference.mp4`: 384×850, 123.223 s.
  Full timeline and enlarged rules (48–49 s), bet examples (9/12/30 s), and
  result (18 s) inspected. Compact blue/gold nine-sector wheel, small countdown
  hub, side tools, history below wheel, three adjacent bet areas, chip piles,
  Repeat and bottom wallet/chips. Nine sectors: one 77, four Watermelon, four
  Plum. Displayed base paytable: 2× / 8× / 2×.
- Clear samples prove repeated chip taps and two funded areas. They do **not**
  conclusively show all three funded. No two-area maximum is stated; Nazraa's
  canonical server already permits all three, so no new selection cap is added.
- The video mentions additional possible awards when 77 wins, but does not
  establish probabilities, amounts or a complete award protocol. These cannot
  be implemented honestly from the supplied material. Canonical
  `lucky77SpecialBonusEnabled=false` stays unchanged.
- No reference-app artwork, footage, audio or source was imported into Nazraa.

## Implemented

Princess uses the same `.74` overlay fraction as Pro (formerly `.94`). The hero
is shorter, with a separate phase/winner strip; three-card reveal, per-chair
hand ribbon, winner side/type and personal payout are legible at compact size.
Owned artwork has a small isolated transform/glow and eight lightweight
canvas hearts during result. Reduced-motion stops idle motion. No video or SDK.

Lucky 77 uses a `.74` compact overlay, no duplicated outer game header, smaller
hub countdown, original gold stand/needle, reference-positioned tools, public
history and three purple betting cards. Existing owned fruit art is retained.
Bet controls remain 88 px high; denominations remain remotely configured and
scroll horizontally instead of becoming tiny on narrow displays.

The old result path awaited tick delays without moving the wheel, then ran a
short animation. It also deferred a new round until that visual completed.
Now movement begins immediately toward the exact server `winningSegment`;
sector artwork and pointer geometry agree. The reveal consumes 55% of the
server result window (300–2,600 ms bound), leaving a real hold. Late entry seeks
to server progress; a new authoritative round cancels the old visual and opens
betting. Late personal settlement updates that same result without another spin.
History is round-ID deduplicated, newest first, bounded at 20 and retains a
just-completed result across temporarily older history snapshots.

The 75 ms lossless intent collection is preserved. Lucky retries a failed batch
twice using **one** immutable ID; stale old-round acknowledgement/error cannot
restore the previous state or discard the new round's queued taps.

## Canonical financial rules — preserved

| Concern | Existing Lucky 77 authority |
|---|---|
| Areas | `watermelon`, `seven`, `plum` |
| Simultaneous areas | Any non-empty subset: all seven combinations |
| Stake | Each tap adds chosen configured chip; repeated taps accumulate |
| Validation | Integer/nonnegative amounts; configured denomination GCD unit, minimum/round maximum; invalid keys rejected |
| Default chips | 100, 500, 1,000, 10,000, 50,000; no chip change from reference guesswork |
| Deadline | Server `betting_ends_at`; canonical default 7 s betting / 1 s drawing / 5 s result |
| Target | Server weighted choice, bet-independent; defaults 77/Watermelon/Plum weights 1/4/4; server selects a matching sector |
| Base paytable | Watermelon 2×, 77 8×, Plum 2×; only selected winning-area stake pays |
| Existing adjustment | `payoutScalePpm=1079545`, maximum payout multiplier 9, existing 1% deduction when adjusted gross exceeds total wager |
| Durability | Transactional Coin debit, unique command receipt, unique round/player settlement, ledger/history/daily aggregate |

Displayed 2×/8×/2× are base paytable values, not a newly guaranteed net return.
No RTP scale, multiplier, fee, probability, reward, currency or wallet rule changed.
Numeric configuration values above are shipped fallbacks, not an assertion that
Master has no production overrides. The Android runtime received chips 500,
1,000, 10,000 and 50,000 and applied them directly. No production rate, chip,
deadline or timing configuration was changed.
Princess still uses its separate standard single deck, three chairs, exact 3×
gross minus 3% service fee, without Pro/Crown/RTP evaluation.

## Real root cause found by database regression

`checkedBets()` expands missing areas to zeros before saving a receipt.
Idempotent retry compared this expanded record with a sparse incoming map.
For example `{watermelon:100}` incorrectly differed from
`{watermelon:100,seven:0,plum:0}`, producing “request ID already used”.

Only Princess/Lucky comparisons now expand canonical zero areas on both sides.
Different amount, different round and unknown keys (including unknown zero keys)
still reject. All other games take the exact prior comparison path. There is no
new table, new financial API, data migration or payout change.

## Verified

- Flutter analyze: no issues.
- Full Flutter suite: **330 passed** (baseline 307 plus scoped new checks).
- All seven Lucky selection combinations; all nine exact sector landings;
  immediate visible spin; delayed settlement; late entry; round-boundary
  cancellation; stale-command failure; 20 rapid taps; same-ID lost-response
  retry; 30 simulated widget rounds; 20-result cap and unique round IDs.
- Princess/Pro identical overlay fraction; 320×420 through 430×900 at 130% text;
  sequential hand labels; final side/hand heading; reduced-motion; bounded idle
  movement; existing 30-round, chip-flight, retry and stale-response tests.
- Local MySQL `verify-lucky77-reference.ts`: fresh disposable database, all
  migrations, seven combinations × three known authoritative outcomes, 30
  total forced-time rounds, **48 settlements (39 winning / 9 losing)**. Actual
  repository transaction/ledger/wallet/history code exercised. Missing history
  0; duplicate debits 0; duplicate settlements 0. Changed/invalid/closed commands
  rejected; retries with omitted/explicit zero areas and after settlement safe.
  Princess sparse retry also passed. Database dropped in `finally`.
- Exhaustive Princess evaluator: 22,100 hands and 5,000 nine-unique-card deals;
  exact video payout example passed. Existing entire core-mobile regression
  suite passed, including other games and media/accounting permissions.
- Backend TypeScript and scoped ESLint: clean.
- Next production build: passed; no deployment performed.
- Only Princess/Lucky visual golden baselines updated, following inspection;
  compact Princess result golden added. Home, Profile, Pro golden unchanged.
- Pro widget SHA-256 `cbc091c64daecfa1bd86ece23ac79f729c63878354f623150c054503f56c0135`;
  Pro engine `7062a001104667ecec248ce45eb0b62ba5a726fb08e99bbc17ef001b0173a054` unchanged.

## Android profile visual check

Both working-tree games opened against the existing backend on Android 16.
Princess's 26 s recording shows server preview/deal, sequential card reveal,
all three hand ribbons, **RED CHAIR WINS • High card**, the highlighted winning
hand and clean next-round reset. Lucky's 22 s recording shows visible travel,
deceleration, exact Plum landing, bounded result hold, history and next betting
round without a persistent overlay. No renderer overflow/uncaught Flutter
exception was logged. Runtime was observation only; all intentional financial
test commands used the disposable local database described above.

The first emulator selected software SwiftShader/Lavapipe because available
host RAM was below its 5,120 MB graphics threshold. It was restarted using host
Metal (Apple M5), not treated as evidence that Nazraa had a 100+ ms phone raster.
Hardware profile traces retained locally:

| Engine timeline scope | Princess p50 / p95 | Lucky 77 p50 / p95 |
|---|---:|---:|
| `Animator::BeginFrame` | 1.113 / 1.659 ms (205 samples) | 2.138 / 5.619 ms (229 samples) |
| `CompositorContext::ScopedFrame::Raster` | 0.024 / 0.033 ms | 0.045 / 0.094 ms |
| `GPURasterizer::Draw` total | 16.469 / 17.544 ms | 13.073 / 20.297 ms |

These are named engine scopes, **not** a relabeling as Flutter FrameTiming build
or raster durations. Princess's finite timeline buffer retained 3.448 s of a
6 s requested sample. Lucky retained 24.846 s of 25 s (including entry/recording)
and had a 224 ms total-draw outlier. This is not a zero-jank/physical-device FPS
certification. No new video decoder or fullscreen animation was introduced.

Source/golden snapshot saved at
`docs/qa/20261015/princess-lucky77/private/mobile-game-source.tar.gz`.
Runtime screenshots/videos remain in the same private local evidence folder.

## Limitations / release state

Widget and local database test clocks are controlled fixtures, not a claim of
30 consecutive human-played production rounds. No paid wagers were placed
against production. Physical low-end device FPS is not certified by an emulator.
The first emulator run explicitly used software GL due to host memory pressure;
its slow raster trace is not presented as phone performance.

No new APK/AAB, website asset or remote version is published by this task.
Backend retry fix and mobile changes must be deployed together for a future
release; production rollback and 2.4.86 downloads remain intact.
