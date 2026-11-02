# Local room music + Lucky Gifts — owner test RC

Candidate **2.5.09+7421**, 2 November 2026. No production deployment,
migration, balance change, policy activation, website upload or GitHub release.
The preserved staging baseline is mobile cd08735 / backend 63222bf.
Before-change bundles and evidence are retained at
`/Users/aishwaryam/nazraa-release-evidence/20261102-music-lucky-rc/`.

## Music

The current Flutter WebRTC bridge does not expose an independent PCM audio
source. We use the permitted mixed-track option, without changing RTC stacks:
Android audio picker → app-private cached file → worker-thread MediaExtractor /
MediaCodec → native-rate mono bounded ring (one resample at the actual capture rate) → m137 capture-post callback → existing
LiveKit microphone publication → SFU → subscribers. There is no local speaker
player, acoustic loopback, extra room, camera replacement or audio publication.
The source is added after microphone AEC/NS/AGC. Speech stays available; logical
mic mute gates only speech while the SDK publication carries music. Stop restores
SDK mute before removing that gate. Party self-mute sync preserves only an authorized, leased music source; staff mute still revokes all publishing. The existing room audio publication uses an Opus 96 kbps ceiling with DTX off so injected music is not treated as speech silence. Decoder buffers stop even if transport cleanup
fails. One serialized native source prevents disposal of an old room from stopping
a newer source. File paths never leave the device; server stores display names.

Common MP3, AAC/M4A and WAV files are selected through Android's audio picker.
Other formats depend on the installed Android decoder. Invalid/encrypted files
fail cleanly, without closing Live. Lucky gift sheets reserve a visible artwork row and scroll safely at large text sizes, with no change to gift prices or settlement. Maximum selected file size is 1 GiB; decoded
PCM ring is capped at 96,000 floats (384,000 bytes), not an entire decoded file.
One server controller/generation has a 60-second lease; controller refreshes every
20 seconds. Native authorization is at most 55 seconds and is capped by remaining server lease minus request RTT and local setup time. State reads/play do not renew it; only a fresh server grant does. Viewers cannot acquire
control. An authorized Party Admin must also hold an existing publishing seat.
Face and Party use the same controller and audio injection path.

Controls reuse Music: Select/Change, Play, Pause, Resume, Stop. Monitor is off to
avoid echo; the selecting Host hears other speakers normally. Receivers hear the
actual current RTP stream when joining mid-song; no metadata-triggered local
copy is played. Temporary transport reconnect preserves the source. Room leave,
Stop, source failure, end of file, lease expiry and room disposal clean it up.

Runtime evidence: Android emulator → local official LiveKit SFU 1.13.7 → a
separate official rtc-node subscriber decoded an 880 Hz MP3. Mean absolute remote
sample was 792.2 on play/resume, 0 on pause, 792.2 with mic muted, 792.2 after SDK
full reconnect, and 0 after Stop. Exactly one current publication remained.
Joining the receiver mid-stream did not restart the source. Native instrumentation
also decoded AAC/M4A and verified speech + music, independent voice gate,
authorization expiry, bounded buffering, and repeated replacement cleanup.
The first full-app encoder path attenuated the remote test tone to about 72 mean absolute PCM units with DTX on; disabling DTX restored about 792 units with the same file/gain/source. The emulator's actual m137 callback rate was 16 kHz (not claimed as 48 kHz output);
the mixer resamples to the actual callback rate. Physical-device music fidelity,
headset routing and long screen-lock behavior remain device QA limitations.

## Economy and private configuration

Normal gifts retain gross debit / floor(85%) recipient Diamonds / remainder 15%
allocation. Lucky uses the canonical `mobile.lucky_gifts` setting: receiver 20%,
company allocation 80%, sender bonus independent. Integer rounding is explicit.
Company allocation is not profit. A send with quantity N is one draw per recipient,
on the full quantity cost. ALL validates the full gross batch before any draw or
credit and settles each actual recipient once, in the same transaction.

Win draw: Node crypto.randomInt(10000) < 2500. Conditional win tiers, total weight
100000: 0.1× 40000; 0.2× 30000; 0.5× 20000; 1× 7000; 2× 2000; 5× 600; 10× 200;
12× 80; 13× 50; 18× 30; 20× 30; 25× 10. No user, balance, country, Agency,
history or rapid-tap input conditions the draw. Maximum exposure is 25× batch
gross, plus recipient allocation; no guarantee of company profit on one event.

Configured expected sender return is 9.75% before integer floors. Expected company
remainder is 70.25% before Rocket/other existing liabilities, infrastructure and
other costs. Unconditional 25× probability is 0.0025% (about 1 in 40,000 attempts).
The retained 100,000 crypto-draw simulation observed 25,233 wins (25.233%), sender
return 9.647%, and three 25× outcomes. Every tier was also deterministically tested.
Weights are Master-only, validated, prospectively versioned and audited; each
transaction stores its own immutable policy snapshot. Default activation is OFF.

Migration 0113 is additive/restart-safe. Historical gift events remain untouched.
Ledger records retain gross spend, receiver Diamonds, accounting-only company
allocation, sender bonus, outcome, balance before/after, server time and frozen
policy. No public response includes private weights or company percentage.
Public terms disclose 25%, fractional-to-25× bonuses, per-recipient batch draw
and whole-Coin rounding. Gift catalogue explicitly classifies NORMAL vs LUCKY.
Master's catalogue links to the internal prospective policy and accounting page.

## Rapid Lucky

A successful SINGLE Lucky send closes the tray and remembers recipient, gift and
quantity. Party and Face render the same compact circular button at lower right,
above bottom actions. The existing foreground surface manager suppresses it while
a game/modal is open. Timer repaint is isolated from media. Each explicit tap is
one unique-ID FIFO request; no auto-send/debounce. Same-ID transport retry and
server receipt replay never charge again. Successful acceptance resets 10 seconds.
Stop drops only queued intents, leaving an in-flight commit intact; insufficient
Coins rejects the whole batch, shows the error and closes the rapid session.
Retried successful Lucky receipts retain their outcome without replaying effects.

## Focused evidence

- Flutter analysis: no issues. 38 focused tests cover controller lifecycle, 20 rapid
  taps, same-ID retry, Stop, inactivity, insufficient balance and existing Party /
  Face PK presentation, Inbox and LiveKit permission semantics.
- Android native instrumentation: two tests, including real AAC/M4A and stereo 44.1 kHz WAV decode, duration preservation through one resample, and the exact PCM callback contract.
- Backend financial suite: four normal contexts 85/15, ALL, concurrent retries,
  rollback, month rollover, historical snapshots and existing manual PK reward.
- New Lucky: 500 gross / 100 Diamonds / 400 allocation, eight concurrent identical
  requests settle once; ALL pre-funding / 200 gross / 40 Diamonds / 160 allocation;
  storage-failure rollback and same-ID recovery; migration replay preserves rows.
- HTTP: real localhost auth/validation, private allocations/weights absent,
  duplicate receipt outcome, Host music permission, viewer denial and Host token.
- TypeScript and Next production build are checked separately.

## RC use and limits

The signed TEST APK uses `tool/owner_music_lucky_staging.dart`: a clearly labelled
local account selector opens the full app with disposable Party Host, Face Host
or sender/viewer sessions. No production credentials or LiveKit API secret are
compiled. Loopback API 127.0.0.1:3998 and SFU 127.0.0.1:7880 require ADB reverse
from this Mac; The local SFU enables loopback ICE candidates and uses ADB-reversed TCP 7881; the initial LAN/NAT path was unreliable for this full-app harness. This changes only the local QA server, not production. Plaintext signaling is
restricted to this local test entry. Production main.dart and secure token rules
remain unchanged. This test artifact is not a public production distribution.
Source/config for the prepared local fixtures remains in protected /tmp files;
local sessions expire after one day. Approval/deployment of backend 0113 and
prospective Master activation are still required before production can use Lucky.
No physical phone was connected; do not infer physical-device or production QA
from the emulator/local-SFU measurements. Earlier baseline Face PK/video/Beauty
work is preserved, rather than reported as freshly production-tested here.

## Final exact signed artifact

- Version: **2.5.09+7421**.
- Compiled mobile commit: **a40b349aa40c7892a981a562c5006bed8dc676b5**.
- Backend runtime source commit: **54cca30**; backend documentation HEAD at build: **88af634**.
- APK: `/Users/aishwaryam/nazra2/dist/Nazraa-Live-2.5.09-7421-release-a40b349aa40c.apk`.
- SHA-256: `f4a475405e39cf3caea484975df9ffb094bfb0c55cbaad19b6f7f73c5cc0304c`.
- Pulled the installed `base.apk`: byte hash matches this artifact.
- Permanent signing certificate SHA-256 matches the prior signed baseline:
  `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.
- Package `com.nazraa.live`; target SDK 36; non-debuggable signed release.
- This is an isolated **OWNER TEST RC**, not a public APK. It needs the local
  API/SFU and ADB reverse documented above. No website/GitHub or minimum-version
  update has been made. The local `dist/Nazraa-Live-release.apk` alias was restored
  to its pre-task production baseline. Superseded test iterations are archived
  under the evidence directory and are not the final candidate.

### Exact-release runtime checks

Party: Android document picker selected the MP3, Play transmitted actual audio
through the unchanged microphone publication; an independent official LiveKit
Node subscriber decoded mean absolute PCM ~792.2. One current audio publication.
One initial Lucky send plus three rapid taps produced **four unique batches**,
**400 gross Coins / 80 receiver Diamonds / 20 sender bonus Coins**. Sender net
Coin change was -380. Stop produced no subsequent financial transaction.

Face: the real full-app Host path authorized through the local backend. The
initial disposable fixture lacked Agency membership and a session ledger row;
only those local test fixtures were completed, using the existing active QA
Agency and canonical accounting schema. No production eligibility bypass.
Received **720×1280 video frames continued** while MP3 music played, paused,
resumed, changed to a stereo 44.1 kHz WAV, and Lucky Gifts were sent. One initial
send plus two rapid taps produced **three unique batches**, **300 gross Coins /
60 receiver Diamonds / 20 sender bonus Coins**; sender net Coin change -280.
No unrelated wallet changed in either exact-release check.

Paused and stopped audio decoded to mean absolute PCM **0.0**, with video frames
still advancing. Resumed MP3 measured ~792.9; the second WAV measured ~589.8
(different synthetic input frequency/channel content, not a quality comparison).
An abrupt **three-second local SFU process outage** forced reconnection. Music
recovered (~589.4), video frames advanced, publication SIDs rebound, and exactly
one current audio plus one video publication remained. The same local Nazraa room
and accounting row remained. This was not a production outage or physical-network
certification. A sanitized music update notice appeared during the outage; the
subsequent successful Stop cleared it, without stopping the room.

Two actual UI bugs were found and corrected during release testing:

1. The level/VIP badge Column in the compact effect used the default expanding
   main axis, stretching the gold notice background over the room. A regression
   test reproduced **600 px height** before the fix; the badge now shrink-wraps,
   the notice is asserted below 100 logical px, and the exact APK screenshot
   confirms a bounded top notice. Underlying controls remain non-intercepted.
2. Face Tools tried to open Music before the current sheet closed, so the overlay
   serializer rejected the new sheet. Music now uses the existing wait-for-close
   helper; selecting Music opens its controls successfully in the exact APK.

The Lucky tray now keeps its gift artwork visible, including small-height and
large-text cases. The 52 px rapid circle and separate accessible Stop sit above
bottom controls and clear the unchanged Games launcher. Games/modals suppress
this temporary control. Rapid remembering is deliberately SINGLE-recipient only;
ALL still uses its existing authoritative full-batch settlement and does not
retain a changing audience set as a rapid target.

### Retained evidence

Directory: `/Users/aishwaryam/nazraa-release-evidence/20261102-music-lucky-rc/`.

- `FINAL_ARTIFACT.json`, signature/badging verification, exact installed APK.
- `flutter-focused-tests.log`: **38 passed**; `flutter-analyze.log`: no issues.
- `native-mix-tests.log`: two native instrumentation tests passed.
- `lucky-simulation.json`: complete 100,000-attempt distribution.
- `exact-final-wallet-reconciliation.json`: exact Party/Face debit and credit checks.
- `exact-final-face-markers.json`: pause/resume, change, reconnect and Stop samples.
- `exact-final-face-media.json` / `exact-final-party-media.json`: actual receiver counters.
- Screenshots: `final-rc-party-music.png`, `final-rc-face-music.png`,
  `final-rc-lucky-panel.png`, `final-rc-face-lucky-panel.png`,
  `final-rc-party-rapid.png`, `final-rc-face-rapid.png`,
  `final-rc-party-compact-gift.png`.

No physical Android device was available. Emulator synthetic camera transport is
verified, not real-person beauty quality. Its audio callback is mono 16 kHz;
physical-device music fidelity, headset behavior, prolonged screen lock and a
real-world weak-network soak remain unverified. No new two-Host production PK
claim is made; focused existing PK/Inbox/permission regression tests passed.
