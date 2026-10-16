# Nazraa 2.4.92+7404 — Princess information advantage and Party icon row

Owner approved two changes only: hide every Princess card until betting closes (keep the fair deck, 3× gross return and 3% fee), and replace Party's two-row labeled controls with one icon-only row. No other game's rules, economy, media, seats or Rocket placement changed.

## Root cause and production audit

Princess exposed one genuine dealt card per chair during open betting. A bet on the chair with the highest visible card has substantially better than one-third winning probability. The old paytable therefore permitted positive player expectation despite the 3% fee. This is an information-advantage defect, not evidence that every production player used this strategy.

Reproducible offline diagnostic `scripts/verify-princess-preview-edge.ts`, 100,000 seeded fair deals: highest visible card won 43,271 times, returning **125.91861 Coins per 100 wagered**. A blind fixed chair won 33,109 times, sample return 96.34719; exact symmetric theoretical return is **97%**, with a **3% long-run house edge**. Neither this margin nor any unbiased finite sequence guarantees company profit in every round/day. No wager-dependent winner selection, rigged losses, altered cards or hidden payout scaling was added.

Read-only production SQL audit (last 72 hours; UTC-date grouping, no identities or private balances exported):

| UTC day | Settlements | Players | Wagered Coins | Paid Coins | Platform net Coins |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-10-15 | 40 | 3 | 205,300 | 249,096 | -43,796 |
| 2026-10-16 | 198 | 9 | 3,702,000 | 3,542,052 | 159,948 |

Across 238 settlements: **0 fee mismatches, 0 net-payout mismatches, 0 winner-wager/3× mismatches and 0 duplicate settlement groups**. Legitimate wins, wallets, ledger and historical outcomes remain untouched. `scripts/qa-princess-payout-audit.cjs` preserves the aggregate-only, transaction-read-only diagnostic.

## Implemented behavior

- Both authenticated HTTP state/command responses and public Redis/WebSocket phase state omit dealt cards while betting is open. The optional `cards` property is absent, not an empty array, because old APKs index any present array. After the authoritative betting deadline the first card may reveal; the existing result phase reveals all hands and the actual winner.
- New round rule version `CHAIRS_3X_FEE3_HIDDEN_V2`. Existing dealt rounds/accepted wagers settle as committed; no outcome replacement, cancellation or historical recalculation.
- New mobile renderer also refuses legacy/stale previews in BETTING, checks preview length and documents the new face-down rule in Help.
- Party has Chat, Mic, Inbox, Tools, Sound and Gifts in one 65dp bar, including a 1dp border, 8dp vertical padding and 48dp minimum tap height. At 320/390/430dp each action is at least 48dp wide. Circular icons have no visible labels; tooltips and accessible names remain. The saved Sound preference and all existing callbacks are reused.
- Games, Emoji and Rocket remain in their original dock. Extra body space automatically returns to the existing responsive room layout. Mic publication, VAD, join/leave, seats and media code were not edited.

## Tests and exact APK evidence

- `flutter analyze`: clean. **392 Flutter tests pass**. Focused 27 layout/Princess tests pass, including all nine cards hidden with an intentionally supplied old preview, every result card matching server data, lossless 20-tap betting, immutable retry and 30 consecutive rounds.
- 22,100 exhaustive three-card hands and 5,000 fair nine-card deals pass. Public preview secrecy is checked for each deal, with post-deadline reveal retained. Exact 3× gross/3% fee and 97% theoretical RTP verified.
- Full isolated MySQL repository suite passes: same-round durable settlement/history/wallet credit, retry idempotency, distinct Pro game, existing payout/Agency/audio-room/reward policies. No synthetic production financial command was executed.
- Typecheck, scoped ESLint, production Docker build, release APK/AAB signatures and full public-file verification pass.
- Only intentional Princess betting and Party room/control goldens changed. Home/Profile golden SHA checks are unchanged. Teen Patti Pro source SHA `cbc091c64daecfa1bd86ece23ac79f729c63878354f623150c054503f56c0135`; LiveKit source SHA `4a2edd2d6ad1a1593754606740a7c205949c069e52d0eb049e8dd597ba36fc1b`, both preserved.
- Exact signed APK installed on Android 16; installed base SHA equals distribution SHA. Existing ordinary QA account opened a live Party. All six row icons align; Tools, Inbox, Gifts, Sound OFF/ON, Games and Princess were exercised. Sound was restored ON. Chat correctly returned the existing face-verification requirement for this unverified account; no verification bypass or claim of a sent chat message. Mic callback is covered by widgets; no unauthorized speaker request was sent.
- Read-only 35-second exact-APK Princess recording shows betting 13/10/7/4/1 seconds with all nine cards hidden, BETS CLOSED first-card reveal, Green Pair winning the completed round, and next betting round with all nine cards face-down. No production wager placed; displayed Coin balance remained 94,233. No Flutter/Android crash, overflow or range errors in the scoped runtime log. Guest seats and room persisted while the game opened/closed.
- A cold-start Android System UI timeout occurred before the new APK was installed and recovered; it was not treated as an app crash/test pass. Continuous Princess animation prevented one UIAutomator idle dump; screenshot/recording evidence was used instead of stale coordinates.

## Production and distribution

Game fix commit `05dd24e7225b5e735f98c5ab28bbd0470cc8707e`; metadata commit `a590e8bd82fac06b490c47d05f2a3fba53b6fe4e`. Files staged from pinned GitHub source only after old/new SHA checks. Only API container promoted; no schema migration, MariaDB/Redis restart, realtime/worker restart or OCI LiveKit change. Production cached WS BETTING round **77919275** verified **0 dealt cards exposed / outcome null** after initial activation.

Public stable release: <https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.92>. Official website <https://nazralive.in/download> and `/release/latest` display **2.4.92+7404**, new file and rule/control notes. Full 229,392,993-byte public APK downloaded/hash-verified on VPS before website promotion.

- APK: `9b8118a8e4405189eb9139bdf5bd3e5a4760ce55a4758ff20ff3859c31bd59be`
- AAB: `2e43dedde54041a0e412b62690f1fd40c62c4134e34f88a7ca91878544e1d4d2` (181,912,091 bytes)
- Permanent signing certificate unchanged: `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`; package `com.nazraa.live`, min24/target36.
- Audited remote config latestVersion updated to 2.4.92 and official download URL. Minimum **2.1.0**, maintenance and every other system setting preserved by digest checks. No forced upgrade.
- Distribution rollback `/opt/nazraa/backups/release-2.4.92` and `nazraa-api:rollback-before-release-2.4.92` retain the Princess secrecy fix while restoring previous website metadata. Pre-fix image/source separately preserved under `/opt/nazraa/backups/princess-hidden-2.4.92`; using that older image would reintroduce the preview advantage and is not the normal website rollback.

Private evidence in `docs/qa/20261016/private/`: exact APK recording/contact sheet, Party screenshot and test logs. Sanitized mobile delta archive SHA `ca41ce3f679811f0090614a3d38f2b9bb53ebe2105d55c154c97eaeae9ec9412` layers over the preserved 2.4.91 full source archive; no keys, secrets or private runtime credentials included.
