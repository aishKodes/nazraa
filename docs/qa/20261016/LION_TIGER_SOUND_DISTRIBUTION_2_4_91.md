# Nazraa 2.4.91+7403 — original sounds and official distribution

Owner explicitly requested original high-quality game sounds and distribution from the official website. Scope: Lion Vs Tiger audio, per-game mute, feature-scoped cleanup, mobile version and public release metadata. No unrelated economy/game/media logic or infrastructure changes.

## Original sound pack

Six original offline-synthesized, lossless 48kHz stereo PCM cues: chip (0.15s), countdown (0.22s), fight bell/whooshes/impacts (4.70s), public victory (1.65s), Draw (1.20s), confirmed personal win (2.25s). No reference-app sound, downloaded sample, voices, paid SDK or ongoing generation cost. Assets total under 2MB; longest decoded sample 902,400 bytes, below SoundPool's per-sample budget.

Source `/Users/aishwaryam/nazra2/tool/generate_lion_tiger_audio.mjs`; provenance and assets `/Users/aishwaryam/nazra2/assets/audio/lion_vs_tiger/`. DC removal, gentle saturation, fades; measured asset peak approximately -4.013dBFS. Personal-win RMS -17.708dBFS; fight RMS -22.104dBFS before deliberately lower in-game gain. These meters are not a claim of physical-device listening quality certification.

Uses the existing bounded Android SoundPool (USAGE_GAME/SONIFICATION), with no audio-focus request or AudioManager/RTC changes. Added feature-scoped stopAssets to stop this game's active/pending cues without stopping other effects. Saved local mute; existing global app and room preferences respected. Background/hidden/close/phase-change stops cues. Late entry and duplicate/reconnected results never replay; positive personal wins require the current round's actual backend settlement. Audio-only chip coalescing never drops a betting intent. No continuous music or looping cue.

## Validation

- Flutter analyze clean; full Flutter suite **388 passed**.
- Audio policy: phase idempotency, stale/reconnect silence, positive versus zero payout, delayed same-round personal payout, last-three-second ticks, 500-round bounded dedupe and mute persistence.
- Intentional Lion Vs Tiger header goldens updated for the sound control; launcher and unrelated screens unchanged. Teen Patti Pro and LiveKit service source hashes remain the protected baseline.
- Exact signed APK installed on Android 16; installed base hash matches released APK. Native channel loaded all six cues; no SoundPool decode failure, Flutter error or Android crash output. Native SoundPool uses USAGE_GAME; standalone audio mode remained MODE_NORMAL. This is not represented as a physical two-Host RTC listening test.
- Read-only 50-second game check: rounds **74670745** and **74670746**, both Lion, then 74670747; countdown, clash, victory/result, history and next-round progression remained functional. Mute and unmute exercised through visible controls and restored enabled. No production wagers were placed by this agent; earlier owner-driven interactions/recording were not counted as automated settlement QA.
- Backend typecheck, scoped lint, Next production build and production Docker API image build passed. No schema migration or financial test mutation.

## Signed artifacts

Version **2.4.91+7403**, package `com.nazraa.live`, min24/target36, permanent signer unchanged (`5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`).

- APK 229,392,993 bytes: `69ad077d0429a5da84da1290d27107b4308b4f2faa44a16b76fa3eaef6601305`.
- AAB 181,910,790 bytes: `3c9111805d8bbfde9030b3bb623d6cc3db2e569a89912d8be4704626b9743fce` (jarsigner verified; usual self-signed Android upload certificate warnings retained in private log).
- Official non-prerelease GitHub release `https://github.com/aishKodes/Nazraa-Releases/releases/tag/v2.4.91`; both uploaded asset digests match local files.
- Full public APK downloaded on VPS, all 229,392,993 bytes hashed before promotion; exact hash matched. Website `https://nazralive.in/download` and `/release/latest` show version/build/hash/new file. Browser-visible download card and link verified.

## Production promotion and rollback

Release metadata commit `00a00ce12d62b5215c664a3893720093aba112b8`. Only `lib/release/latest-release.ts` mechanically staged after existing-file and downloaded-source SHA checks. Only API container replaced; realtime, worker, Redis, MariaDB, Caddy and OCI LiveKit untouched.

Audited SYSTEM maintenance changed only mobile latestVersion to 2.4.91 and updateUrl to official `/download`. Existing minimum **2.1.0**, maintenance and every other system setting preserved/checked. No forced upgrade added. No credentials, OAuth, media provider/routing or payout rule changed.

Rollback: `/opt/nazraa/backups/release-2.4.91` holds previous metadata, image ID/manifest, build/activation logs, full public-binary verification and version-publish log. Image tag `nazraa-api:rollback-before-2.4.91` retained; previous GitHub releases remain public. Rollback would restore the saved source and image as `nazraa-api:production-candidate`, then replace only API; the audited previous mobile-config row can be restored if necessary. Do not drop schema, roll back wallets or change minimum version.

Private local evidence under `docs/qa/20261016/private/`. Sanitized mobile source archive SHA-256 `156022bcce17db203bfd7a255097a6ea70b4a2eca853aca9108ec650861d788f`; includes modified Kotlin sound handler, no signing keys or server secrets.
