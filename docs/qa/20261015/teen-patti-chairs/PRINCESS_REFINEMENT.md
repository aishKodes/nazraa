# Teen Patti Princess refinement — 2.4.85+7397

## Owner scope

Only the separate `teen_patti` game presentation and Agency removal/reapplication workflow change. `teen_patti_pro`, game economics, reward rules, LiveKit and room media lifecycle are preserved.

## Reference inspection

Reinspected the 178.959-second owner video with dense frame sequences at 70–82s (3 frames/second) and 155–167s (2 frames/second), not only still screenshots. Observed functional behavior: chips fly onto the selected chair and remain as piles; separate card flips; compact round-stage/countdown; winner light/pulse; losing-chair chip collection followed by winner distribution. Reference character/background/artwork are not copied.

## New-game presentation

- One in-panel title: **Teen Patti Princess**. Matching Game Center and Control labels; stable ID remains `teen_patti`.
- Removes repeated three-chair/three-card/rules strips and duplicate status copy. Full financial/ranking rules remain accessible through Rules.
- Original canvas-rendered multicolor casino chips, visible curved/rotating 520ms intent flights, persistent piles based on genuine public chair totals, highlighted own contribution and amount feedback. Repeat animates the actual repeated intents too.
- Incoming public pot increases animate without exposing other players' individual wagers/identities. Historical totals never replay as fresh bets.
- Staggered nine-card deal on the next live round; server-targeted 2.1s sequential reveal. No client-side hand evaluation or winner selection.
- A bounded 1.65s chip sweep/payout motion, chair pulse, particles and own-win banner; fits inside the existing five-second result interval. Zero-wager chairs do not fabricate collected chips. No new full-room effect, route or media player.
- Controllers are scoped to this game and disposed. Short animations only; bounded flight list. Existing 75ms lossless command batching and immutable request retry remain intact.

## Agency authority

- Master Host detail now has an explicit **Remove Host from current Agency** button, separate from assignment.
- Master-only repository guard, reason, confirmation, audit, durable membership end, user notification and both current relationship mappings updated atomically.
- User-first transaction locking matches mobile apply/review. Concurrent duplicate removals are harmless. Expected-current-Agency guard rejects stale forms rather than removing a newly changed association.
- Existing terminal application history is retained, not a blacklist. Removed Hosts may submit a new request to the same or a different eligible Agency. Concurrent repeated pending clicks return the same request.
- Mobile Agency page refreshes authority on entry/resume and has an explicit refresh action. Apply choices precede historical records. No reinstall/relogin required.
- Account, wallets, live history, historical payout snapshots and Agency ownership are not deleted.

## Evidence

Isolated MySQL core suite passes Master cross-branch removal, concurrent retry, same/different Agency reapplication, pending dedupe, stale form, current mobile state and audit checks. Eight-role Control integration passes; all non-Master roles are denied global removal. Existing payout snapshot preservation tests remain green.

Flutter tests cover three screen sizes at 130% font, visible chip movement and persistent/cleared pile, 20 rapid taps, lost response, stale-round rejection, exact server-result presentation, late entry, 30 consecutive rounds and the intentionally revised new-game golden. Existing Pro/Home/Profile goldens are not replaced.

Production deployment, signed artifacts and exact-APK visual results are recorded after completion, not inferred from repository tests.
