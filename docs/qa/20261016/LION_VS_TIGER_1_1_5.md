# Lion Vs Tiger — test 1.1.5

## Scope and reference

Owner's full 68.781-second `lion-vs-tiger.mp4` inspected at one-second intervals, plus full-size Rules and winner frames. Original Nazraa-owned characters/arena/icons replace reference pixels. Existing game mechanics, wallet, payout, media and rewards remain unchanged outside the new game branch.

The video confirms Tiger ×2 / middle ×30 / Lion ×2. Its Rules screen does not define the middle result or probabilities. Owner explicitly delegated these unspecified decisions in chat: “make it whatever is more logical and makes game more interesting”.

## Canonical new-game rules

- New ID `lion_vs_tiger`, separate from Greedy Lion and both Teen Patti games.
- Exactly 15 seconds server-authoritative betting; same global round for everyone.
- Three areas: Tiger, Draw, Lion. Any nonempty subset of up to three; repeated top-ups allowed before close.
- Gross returns including the winning stake: Tiger 2×, Draw 30×, Lion 2×.
- Draw means neither fighter wins. Only Draw wagers pay; other wagers lose, with no refund side rule.
- Secure fixed bet-independent weights 15 : 1 : 15. Every selection has gross mathematical return 30/31 (96.7741935%). No outcome reacts to exposure/player/bet history.
- No added service fee, hidden RTP scaling or game-specific stake/payout cap.
- Positive whole Coins, sufficient balance and exact numeric representation required. The platform's numeric protocol is bounded by Number.MAX_SAFE_INTEGER; every potential payout and post-bet balance is checked before accepting a wager. This is not an arbitrary 50M platform stake limit.
- Five-second competition and four-second result presentation follow betting. They are locked/settlement periods, never extra betting time. These presentation periods were chosen under the owner's delegated decisions, not claimed as hidden reference rules.
- No Crown, autoplay, cards, reshuffle, third currency or client-selected result.
- Platform right of final interpretation is included in the Rules panel.

## Existing engine reused

Shared rounds, cryptographic randomness, authenticated commands, SQL wallet/ledger, durable request IDs, unique settlement records, daily winner aggregates, Redis/WebSocket transitions, bounded history and existing worker. No new game timer service or financial tables.

Migration 0105 adds nullable per-row game discriminators with a matching round/game FK. Only new-game records may exceed legacy caps. Old binaries inserting NULL and existing records retain the old database limits. Historical bets/results are not recalculated. DDL handles MySQL and MariaDB check-constraint syntax.

## Tests recorded

- Isolated financial harness: 30 rounds, all 7 nonempty selection combinations, 48 settlements, zero missing/duplicate payouts, zero fee. Bets >50M accepted only for the new game. Exact deadline rejection, sparse retry normalization, changed-command rejection, concurrent same-ID retry, 20 newest unique histories; old-game database caps preserved.
- 373 Flutter tests passed, including the new responsive board, all three authoritative targets, custom >50M amount, lossless 20-tap batching, immutable retry and next-round chip clearing/history retention.
- New intentional game/launcher goldens inspected; unrelated screen baselines unchanged.
- Typecheck, targeted ESLint, Next build, existing core-mobile and Lucky/Princess/King regression harnesses run. Final deployment/artifact evidence is appended after verification.

## Original artwork and prompts

- `/Users/aishwaryam/nazra2/assets/games/lion_vs_tiger/ARTWORK.md`
- `/Users/aishwaryam/nazra2/assets/games/launcher/ARTWORK.md`

Eight local 384px covers, 1024px transparent fighter sheet, 960px arena. Combined WebP art under 1MB. No recurring SDK, network art fetch or video decoder.
