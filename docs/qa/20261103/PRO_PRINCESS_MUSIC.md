# Princess / Pro / Room Music correction

Scope: mobile baseline 2440e51 (2.5.14+7426), backend source 4b193918.

## Root causes and implementation

- Princess temporary podium queried daily contributions and retained that map across round changes. Both games now project current round `game_shared_settlements.payout_total` only, with round ID, explicit ROUND scope and monotonic settlement count. New rounds clear all temporary winners.
- Princess discarded an authenticated accepted-bet receipt behind a newer public phase clock. Both tables now preserve bounded authenticated private receipts independently of public phase state. A public event cannot write personal wagers or wallet balance.
- Participation-only events reset the server/monotonic countdown anchor. They now preserve both anchors and the phase, with a separate monotonic activity version. The Redis projection rejects older round IDs/versions; Pro now also receives public accepted-bet updates.
- Only newly committed Princess outcomes carry the owner-approved starting-card visibility marker. Existing rounds retain their committed visibility, paytable and fee. Hidden cards/final outcome remain absent during betting. RNG, payout, cap, currency and ledgers were not changed.
- Room Music had no local monitor, and both backend/native Play reported success before decoding or audio flow. One MediaCodec PCM timeline now feeds post-AEC digital music into the existing authorized microphone publication and a bounded asynchronous Android AudioTrack monitor (music only, no local mic loopback). No second LiveKit Room/track is created.
- New clients use prepare → confirmed local/publication flow → ready. Errors cannot mark Playing. Pause/Stop clear both outputs while retaining the actual mic preference. Transport reconnection pauses source progress and local output, and resumes the same source after recovery. Legacy local-start remains compatible.

## Primary reference inspection

The complete owner-supplied 90.73-second Pro video was inspected at one frame/second, with three full chronological contact sheets. Also inspected all 26.61 seconds of the existing Princess reference. Matched compact aqua table, Crown plaque, three arch sides, moving/accumulating chips, actual participants, sequential reveal/turn, gold winner path and payout motion, bounded current-round podium and reset. Nazraa's art and accepted financial rules are preserved.

## Executed evidence

- Flutter analysis clean.
- 44 focused checks passed (table reconciliation, Princess, Pro retry/20 rapid taps, music controller); one optional evidence export skipped unless explicitly requested.
- Three Princess SQL rounds with all three winning chairs: three actual users, 600 accepted Coins / 1,620 durable returned Coins each round; exactly-once retries and settlement; previous-round winners absent after reset.
- Three Pro SQL rounds: three actual players each, payout ordering matches only the corresponding existing settlement rows, retries idempotent, new-round activity empty.
- Real authenticated WebSocket receiver, six accepted commands/game on isolated localhost: Princess remote p50 29.2 ms / p95 91.6 ms; Pro 13.4 / 14.8 ms. No receiver SQL refresh, personal balance or private wagers in events. These are local measurements, not Internet/production claims.
- Android 36 MediaCodec/AudioTrack instrumentation: three tests pass, including MP3 stereo 44.1 kHz, actual monitor render progress, nonzero outgoing music PCM, speech preservation, pause/resume, source stop/change, corrupt-source rejection and transport-progress suspension/recovery.
- Actual full-app Party Room Music selected MP3 via system file picker. Native play_confirmed logged only after decoder and monitor output. A separately authenticated LiveKit participant received nonzero audio on the Host's existing audio SID. Pause/resume continued that source. No duplicate active publication.
- Broader Flutter run: 529 passed, 22 known baseline failures plus intentionally changed Pro golden (subsequently reviewed and updated). The baseline's identical 22 failure names are preserved in the evidence comparison; unrelated tests/designs were not silently changed or marked passing.

Evidence directory: `/Users/aishwaryam/nazraa-release-evidence/20261103-pro-music/`.

Physical Bluetooth/headset and human listening are not claimed from emulator tests. Android AudioTrack render progress and separate decoded LiveKit RTP PCM are the actual audio evidence. Release recordings/artifact checks will be appended after verification.


## Final release and production verification — November 4 IST

- Signed release: **2.5.15+7427**, compiled mobile commit `871b06b3fe8d2df8c7ec4e41848ddda231cde03b`. APK package `com.nazraa.live`, min SDK 24, target SDK 36; permanent signing certificate unchanged.
- APK SHA-256: `24b480a5267b03a337c3a3e7713e021e41fe665f7b531e26c1f81b1add517640`.
- AAB SHA-256: `d92fee9450760b771c6e4fee1f65142bf062cb227f4fdf3d661bd6351425ecd9`.
- Public page: https://nazralive.in/download. Published assets: https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.5.15. GitHub digests match; a full external download of the public APK was byte-count/hash verified. Exact signed APK installed and exercised on Android 36.
- Latest app config points to 2.5.15 / build 7427. Existing minimum version 2.1.0 was preserved. No second APK was needed for the subsequent backend repair.

### Production-only Pro failure found and corrected

The final exact-APK production check caught missing result phases despite successful isolated-stack tests. The common maintenance endpoint had been returning 503: an October 31 accepted Pro wager covered all three hands (2,000 Coins total). Admission validated each separate request, whereas settlement re-applied the two-hand admission rule to their aggregate and threw. Because maintenance previously aborted its entire loop, that one unresolved record also suppressed publication of healthy phase states.

Backend `e758e2e` fixes the actual mismatch. After acquiring the existing wallet lock, new Pro commands validate all previously accepted hands plus the new intent before any debit. Sequential and concurrent third-hand attempts are rejected without deduction; Crown remains independent. Previously accepted lines settle using their immutable original paytable, without retroactively rejecting admission. The stranded production record now has exactly one settlement (1,389 Coins payout under its existing outcome/rate). No outcome, rate, fee or wallet record was manually fabricated or rewritten. New financial retries and the old nullable game discriminator are covered by real disposable-SQL tests.

Backend `c32abc3` isolates transactions/failure reporting per game, so one unavailable table cannot silence every healthy table. Private cron diagnostics contain only game/stage/error code. No SQL, raw responses or secrets enter mobile UI.

### Measured phase-publishing delay

The original maintenance pass also took 4,514 ms, longer than Pro's 2-second drawing window. Query plans showed each game scanning all 331,147 historical bet lines and latest-round lookup filesorting approximately 182,000 round rows. Backend `cb4af7f` plus additive migration `0116` provides the covering game/round/user lookup, preserves nullable legacy rows, tests settlement existence before historical round lookup, and uses indexed MAX(start time) with the original round-number tiebreak.

Actual production samples: settlement lookup **451 → 60 ms**, latest-round lookup **531 → 1 ms**, whole seven-game maintenance **4,514 → 598 ms**. These are measured server samples, not invented percentile claims. No cadence/economy setting changed. All deployments checked fresh verified offsite backup, source rollback image/archive, unchanged protected settings and preservation of the other 14 container identities. Only API was restarted; LiveKit/media were untouched.

A passive 46-second production Redis observer then recorded all three phases and authoritative result outcomes: Princess 11 events / 4 observed round IDs, Pro 10 events / 3 observed round IDs, each with five result lifecycle events. These include partial boundary rounds; they are not claims of four complete rounds in 46 seconds. Unrelated Lucky 77/Lion-vs-Tiger next-round creation occasionally logs retryable `ER_CHECKREAD`; the next worker pass recovers. Healthy-table phase publication remains isolated.

### Final actual-app evidence

- `exact-apk-production-pro-final.mp4`: exact published APK, real production state, complete betting/lock/sequential reveal/winner/reset. No production bets placed.
- `exact-apk-production-princess-final.mp4`: exact published APK, real production opening card per chair, reveal/crown and next-round reset. No production bets placed.
- `pro-full-app.mp4`, `princess-full-app.mp4`: actual full app with isolated real SQL/API/WS accepted wagers and three players, winner/podium/next-round reset. These are not mock screens or production wagering.
- `production-scheduler-sql-before-after.png`, `production-phase-verification.png`, `production-pro-legacy-recovered.png` and `final-production-verification.json` retain the production results.
- `music-audio-proof.json`, `room-music-rtp.json`, `android-monitor-actual-route.txt`: native monitor's actual speaker route and rendered frames; real separately decoded remote RTP (playing/resumed mean absolute PCM 448.5, pause 0 for 26.5 seconds), exactly one active Host audio publication. Three native tests pass.

Final focused Flutter count is **49 passed**, not the earlier 44. Full-run comparison retains the same 22 pre-existing broad-suite failures; the additional deliberately changed Pro golden was visually reviewed and passes separately. No unrelated golden was blanket accepted. Physical headset/Bluetooth and human listening remain unverified; emulator AudioTrack and RTP evidence do not establish every physical route.
