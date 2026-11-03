# Teen Patti Princess — owner chart update, 3 November 2026

## Implemented scope

Only Princess game ID `teen_patti` is changed. Teen Patti Pro, other game implementations, chip amounts, the wallet write path, fair deck/RNG, accepted payout profiles, settlement arithmetic and LiveKit/room code are preserved.

- One original `PrincessWinnerAnimation` runs inside the actual winning chart. It rises/scales in, fans gold wings around a jeweled crown, moves light particles, and displays a purple WINNER ribbon. The server decides the winner; losing charts dim after card reveal. Existing reveal/award controllers own the animation; no video decoder or additional repeating timer is created.
- Each chart shows independent Top 3 today, using existing business-day semantics and existing immutable daily winning contributions, grouped by the authoritative result's winning chair. Values are settled net credited Coins. Rank, canonical profile name/DP and Coins won are shown; tap a chart's list for readable details. Empty means no eligible winners, not invented accounts.
- A post-commit optional public projection provides round ID/number, accepted-command version, totals and up to three participant avatars per chart. The existing Redis/WebSocket path broadcasts it after acceptance. No private wallet or personal-bet response is broadcast. Display-projection failures never turn a committed wager into an apparent failed financial command.
- Round-ID/number and monotonic versions reject stale data. New round clears totals, chip piles and current participants, while keeping daily rankings and durable history. Business-day change may reset daily ranks.
- The chart's loud `2.70× NET`, older gross coefficient labels, and RTP/internal fraction labels were removed from the player-facing board. `2.70` represented the actual net return, not an arbitrary debug number. Rules continue to disclose the material payout in Coins: 100 on the winning chair returns 270; 1,000 returns 2,700, with the existing 5% gross fee/rounding explained. No paytable or payout arithmetic changed.
- Short game panels allocate more space to the board and keep controls usable; populated 320×420 and 390×560 layouts pass at 130% and 180% text scaling.

## Reference inspection

Both owner videos were examined over their entire duration using timestamped sheets, then the first video's winning sequence was inspected at finer intervals. `15.25.38.mp4` supplies the card reveal, winning-chart border, crown/wings, glow and purple ribbon behavior. Original Nazraa painter geometry is used. `15.55.54.mp4` is gifting-related and was not used to change unrelated gifting.

## Focused verification

- `flutter analyze --no-pub`: no issues.
- Princess/shared-game/WebSocket focused Flutter tests: 45 passed, optional evidence exporter skipped in ordinary test runs.
- Actual MySQL test in explicitly disposable `nazraa_mobile_qa_*`: all three chairs, three actual fixture winners per chair, accepted stakes 100/200/300, settled net ranks 810/540/270 and 1,620 total credited Coins per round; identical retries and repeated maintenance settle once. New round clears all three pots and participant lists without deleting prior contributions.
- Same-name accounts retain distinct canonical IDs and their own configured DP URLs; temporary fixture profile changes restored.
- Actual production WebSocket edge implementation on isolated loopback ports, canonical auth handler, two fresh test sessions, actual accepted 100-Coin wager and retry: both receive the public projection before any result; balance debited once from 10,000 to 9,900; no wallet/private bet fields in broadcast.
- Thirty consecutive controlled Princess rounds, 20 lossless rapid taps, cross-round rejection handling, late result entry, stale public events, ranking version preservation and daily rollover covered.
- Two Princess goldens were intentionally updated after visual inspection. Other golden baselines were not updated.
- Full Flutter suite: candidate 513 passed / 22 failed / 1 optional export skipped. Untouched archived 2.5.12 source: 504 passed / the same 22 failed. Comparison finds zero newly failing tests. Existing failures include older Home/Profile/room visual/selector expectations and a Lucky 77 expectation; these unrelated modules were not modified to manufacture a full-suite pass.
- Backend TypeScript typecheck passed. Existing cross-game RTP verification passed; no economics edited.

## Evidence and limits

`green-winner.mp4`, `blue-winner.mp4`, `red-winner.mp4` are actual Flutter UI frame exports, using outcomes/projections from the controlled SQL test. They are not recordings of live production wagers. `flutter/*-top3-details.png` shows the actual detail sheet; `*-betting-before.png` versus `*-betting.png` shows accepted participation before the result; `*-reset.png` shows the next round empty while settled rankings remain. DP fallbacks are truthful where fixture accounts have no uploaded image. Real DP URL identity mapping is separately asserted.

Physical multi-phone QA was not performed. Two real authenticated logical WebSocket clients and Android emulator release checks provide the available coverage. No claim is made that unrelated pre-existing full-suite failures are fixed.
