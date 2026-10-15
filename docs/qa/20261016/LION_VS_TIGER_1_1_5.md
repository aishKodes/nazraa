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

## Production deployment and rollback

- Backend commit `24e31870b586c315ceb8367a517feec91cef2a4a` deployed to the existing VPS. Only API/realtime services replaced; LiveKit, database, Redis, Caddy and the existing worker were not restarted.
- Fresh encrypted off-VPS backup `nazraa-nightly-20261015T190455Z` completed before deployment (4,947,195,138 bytes).
- Migration 0105 SHA-256 `9a8d017fbd147592a788f8387591640adbacb040ba11b4d4ea2596084ac276d5`. Applied twice to empty cloned schemas on the production MariaDB 11.8.9 engine before production application. New-game large-amount and old-game/NULL legacy constraints passed. The disposable schema was removed.
- Production migration completed in 12.4 seconds. Ready endpoint returned 200; Redis exposed the new game and SQL round timestamps confirmed exactly 15 betting seconds.
- Previous source/config manifests and schema definitions retained at `/opt/nazraa/backups/lion89`; rollback images `nazraa-api:rollback-before-lion89` and `nazraa-realtime:rollback-before-lion89`. Nullable schema extension remains backward-compatible; do not drop it or recalculate financial records on rollback.

## Exact signed APK verification

- Version `2.4.89+7401`, package `com.nazraa.live`, target SDK 36. Permanent signing certificate unchanged.
- APK `Nazraa-Live-2.4.89-7401-test.apk`, 227,023,140 bytes.
- SHA-256 `226efa8c30b62a8ac17c8b195b3f6bb019b60f6351525329c1bdd4b600eebcfd`.
- Exact APK installed on Android 16 emulator; installed base APK hash matched. Existing ordinary QA session used; no credentials extracted, role changes or production bets.
- Read-only 50-second recording covered complete rounds 74670508 and 74670509, then entry into 74670510. Both observed outcomes were Tiger. Countdown, five-second competition, winner highlight/banner, next-round transition and newest-first history updates were visible. Balance remained 95,821 Coins.
- All three result targets, including Draw, are separately covered by controlled widget/financial tests; this short production recording is not claimed as a live Draw or monetary settlement test.
- No Flutter/AndroidRuntime error output after observation. Recording/contact sheet retained privately under `docs/qa/20261016/private/`.
- Published owner test prerelease `https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.89-qa`. This is not a forced stable rollout: existing stable download/latest/minimum versions remain unchanged.
- Downloaded the complete 227,023,140-byte public GitHub asset after publication; its SHA-256 matched the installed/tested APK exactly.
- Sanitized mobile source archive (lib/assets/test/pubspec only) retained privately; SHA-256 `40da054aaf388ec2efc0414a6dbfcd06b01d31ebdbca8e0b71a4b42a99be269c`. No signing keys or backend secrets included.
