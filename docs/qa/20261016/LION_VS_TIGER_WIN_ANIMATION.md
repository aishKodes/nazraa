# Lion Vs Tiger — win animation follow-up

## Scope

Owner reported the 2.4.89 arena looked static and lacked the reference's win animation. Re-inspected the complete 68.781-second local `lion-vs-tiger.mp4` and a three-FPS contact sheet of seconds 10–22: alternating fighter poses, dust-cloud competition, triumphant winner/defeated opponent, result treatment and personal payout.

Only Lion Vs Tiger's visual layer, its tests, assets and mobile version metadata changed. No backend deployment, rule/odds/payout changes, database migration, or changes to other games/media are required.

## Implementation

- Original Nazraa eight-pose transparent atlas: Tiger/Lion guard, jab, recoil and victory. Existing art retained; no proprietary video pixels copied.
- Five-second competition: alternating jab/recoil, approach/movement, bounded cloud, sparks and orbiting stars.
- Authoritative result: final strike then winner steps forward, raises gloves and jumps; loser recedes. Draw remains a distinct no-winner presentation.
- Rotating rays, confetti, result ribbon. Personal Coin burst and count-up only when the current round's backend settlement actually has a positive payout. No fake player wins or wallet mutation.
- Current `bettingEndsAt`, `resultCommittedAt` and the server receipt anchor synchronize presentation. Late entry/foreground resume skips elapsed action; delayed personal settlement does not restart the fight. Next round replaces the result without waiting for animation.
- One local ticker, cached atlas, bounded CustomPainter; no video decoder, audio playback, network assets or parent-room animation ticker. Ticker stops while hidden/backgrounded and respects reduced-motion settings. Sprite headroom includes raised gloves/jump/rotation.
- Atlas 1536×768, 314,942 bytes. Prompts and built-in image-generation provenance saved in `/Users/aishwaryam/nazra2/assets/games/lion_vs_tiger/ARTWORK.md`.

## Validation

- Choreography tests iterate both authoritative winners across 30 visual rounds; no client winner selection.
- Personal positive/zero payout, three responsive dimensions, small-screen clipping, hidden/background ticker cleanup, late/reduced-motion result, history/next-round reset, all three result targets and existing 20-tap retry/betting tests.
- Intentionally revised only Lion Vs Tiger arena golden and added three winner/Draw goldens. Launcher golden SHA-256 remains `09a374e4c6042c4ef86cb7325415a5e78b4482fc2d3633fcc16d2cd00ccfbd26`.
- Protected Teen Patti Pro SHA-256 remains `cbc091c64daecfa1bd86ece23ac79f729c63878354f623150c054503f56c0135`; LiveKit service remains `4a2edd2d6ad1a1593754606740a7c205949c069e52d0eb049e8dd597ba36fc1b`.

## Release verification

- Full Flutter suite: **382 passed**. Flutter analyze: **no issues**. Original launcher golden unchanged; only the game-specific new result visuals intentionally updated.
- Signed production-environment test APK **2.4.90+7402**, package `com.nazraa.live`, min SDK 24 / target 36. Permanent signer SHA-256 unchanged (`5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`).
- APK size 227,355,834 bytes; SHA-256 **`f5e6a3a8aaabf504997e344aa6517bb4ea4ae589243eee306c8de8af839ff086`**. GitHub uploaded asset digest matches.
- Installed exact APK on Android 16. Read-only 50-second production recording covered round **74670655 (Tiger)**, **74670656 (Lion)** and start of 74670657. Visible countdown, changing jab/recoil poses, cloud/stars, each correct winner's raised-glove jump, loser recession, confetti, result ribbon, history append and next-round transition. No production bet placed. Zero Flutter/AndroidRuntime error output. Personal Coin count-up/burst validated using controlled positive/zero-payout fixtures, not a claimed production payout test.
- Full recording, contact sheet, logs and a cropped 13-second visual preview retained in `docs/qa/20261016/private/`. Sanitized mobile-source archive SHA-256 `111d34f049580bdaf24dca95a975eb0b37d73be15cfcc7d0cd9a12f6663bafce` (no signing keys or environment secrets).
- Test prerelease: `https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.90-qa`.

Stable website/latest/minimum version and all backend/media configuration remain unchanged. No AAB was requested for this owner test iteration.
