# Separate TeenPatti — three chairs

Existing Teen Patti Pro retains its ID, widget, engine, payouts, Crown, limits and history. This addition uses `teen_patti` / `TeenPatti` and independent server rounds; shared transactional wallet, settlement, history, daily ranking and Redis/WebSocket infrastructure are reused. No new financial tables or migration is required.

## Reference and rules

Inspected the complete 178.959-second owner video `new-teenpatti-reference.mp4`, including the rules, history and final winning return. Nazraa uses original generated environment/dealer art and code-rendered chairs, cards and chips, not extracted reference assets.

- One unbiased cryptographically shuffled 52-card deck. Three cards per Green / Blue / Red Chair, dealt round-robin without replacement.
- First card is visible during betting, following the video; six other cards and winner remain secret until the server reveal.
- Every winning chair pays exactly 3× its wager. Exactly 3% of that gross return is withheld; never Pro's 1% or RTP adjustment.
- Video example: Red 110,000 + Blue 95,000; Red wins → 330,000 gross − 9,900 fee = 320,100 returned.
- Betting 100 on all three: 300 gross − 9 fee = 291 returned. Fee is not conditional on overall net profit.
- Trio > Flush Straight > Straight > Flush > Pair > High card.
- Owner delegated unspecified comparisons: AKQ > A23 > KQJ … >432; KA2 is not a sequence. Pair compares pair rank, then kicker. Flush/High compare every rank descending. Only after category and points tie, compare the highest card's suit: Spades > Hearts > Clubs > Diamonds.
- No Crown, arbitrary lane multipliers, weighted outcomes, return-target scaling, Auto Play or Pro two-hand limit. All three chairs may be bet.
- Chips 100 / 500 / 1,000 / 5,000 and Repeat follow the reference. Default cadence: 15s betting, 3s locked, 5s result; server owns timestamps. Reveal is 2.1s, synchronized on late entry.

97% is the nominal blind return, not a promised strategy-independent RTP: the visible first card may inform choice. No hidden weights or outcome adjustment are introduced to enforce a return target.

## Reliability

- Existing 75ms lossless batcher; one in-flight mutation, identical idempotency key on retry.
- New round clears current bets and bounded chip flights. A previous round's win never appears in the next round.
- Public WS phase/result/preview state; local countdown; authenticated reconciliation for personal settlement. No per-second SQL timer polling.
- Readable same-table rules, server history, My Investments, Daily Top 20; other players' bet choices are redacted.
- Game is an isolated room overlay. No LiveKit/seat/media lifecycle code changes.

## Original art provenance

Tool: built-in image generation. Output source: `/Users/aishwaryam/.codex/generated_images/01a070d7-8074-7233-a3a3-8877090aa8be/exec-96ae7960-0fbb-4e17-881e-44bd50956bfe.png`.

App asset: `/Users/aishwaryam/nazra2/assets/games/teen_patti/garden_dealer.jpg` (1000px long edge, compressed JPEG). This is a static scene layer; cards, chairs, chips and reveal animation are independent interactive layers.

Prompt: “Use case: stylized-concept. Asset type: original premium mobile card-game environment and dealer illustration, not a UI screenshot. Create an original polished 3D-painted Indian seaside garden card lounge for Nazraa's new TeenPatti game. Landscape composition approximately 4:3. An adult South Asian woman dealer in elegant turquoise and warm gold clothing, original facial design, dark braided hair, friendly confident expression, seated centrally behind a warm carved wooden counter. Lush bougainvillea, tropical leaves and soft turquoise water with a distant pavilion. Beautiful warm daylight, refined materials, crisp game art with depth, inviting and colourful. Character waist-up, face in upper middle, hands resting naturally on counter; counter near bottom of composition. Keep peripheral detail gentle so overlaid UI is readable. No game UI, no letters, no text, no symbols, no cards, no chairs, no buttons, no watermarks, no logos. Entirely original character and background; do not reproduce an existing game's character. This is a static background layer; actual cards/chairs/chips will be rendered independently in code.”

## Test evidence

- `scripts/teen-patti-rules-tests.ts`: all 22,100 three-card combinations, six category counts, hierarchy/points/suit comparisons; 5,000 unbiased deals with nine unique cards and exact strongest-hand winner; exact reference payout, fee with no net profit, fixed rule guards.
- `scripts/verify-core-mobile.ts`: temporary isolated MySQL database; preview secrecy, all three chairs, exact debit/settlement/fee/history/idempotency, 30 rounds of new game plus existing games and economy/media authority regressions.
- `scripts/verify-websocket-transport.mjs`: private ephemeral local Redis; authenticated new-game channel, preview delivery and invalid-token denial.
- `test/teen_patti_chairs_test.dart`: three compact/large widths at 130% font scaling; rapid 20-tap/all-chair test, lost response retry, reveal/result ordering, immediate history, next-round clearing, late entry, 30-round UI soak and intentional new-game-only golden.
- Existing Pro source files are not edited. Existing Pro evaluator/widget/financial tests remain release gates.

Production deployment, exact signed-artifact runtime evidence and public download status are recorded separately only after verification; repository tests alone do not establish a production pass.
