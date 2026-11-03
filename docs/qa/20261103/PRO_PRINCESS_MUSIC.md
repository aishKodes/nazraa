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
