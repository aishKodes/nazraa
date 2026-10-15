# Party microphone and adaptive chat — 2.4.83+7395

## Root causes and fixes

- Party auto-seat updated MySQL but never upgraded an already connected LiveKit listener's microphone permission. Seat accept/leave, microphone changes and token reconciliation now apply the latest authoritative membership capability to that participant, without reconnecting the Room.
- Token authority mistook self-mute for loss of the accepted speaker role. A deliberately self-muted seated Party speaker retains audio-only capability; reconnect preserves `microphoneMuted`. Staff mute revokes publish capability, cannot be bypassed by reseating, and lifting it does not remotely open the user's microphone.
- The Flutter permission transition could report success merely because a Room existed. It now waits for the microphone permission update and verifies microphone publication. Explicit unmute persists server authorization before opening hardware. Mute closes hardware first; a failed request never reopens the mic as compensation. Stale presence snapshots cannot automatically unmute or resubmit a toggle.
- Chat was capped at 92px, given only four activities, then followed by a blank Spacer. The board now uses its natural/available footprint and chat receives all remaining height. The bounded virtualized activity list is no longer trimmed to four entries. Audio PK keeps its bounded board and uses the remaining space for chat.

## Verification

- Flutter analyze: clean. Full suite: **289 passed**, including sparse/dense layout matrices and more-than-four feed items, scrolling/unread preservation and existing Face/game/effect checks.
- Backend TypeScript: passed. Core mobile repository integration: passed, including new self/staff mute/reconnect/reseat assertions and the updated Audio PK contract. Control: 30 groups / eight roles passed. No financial or reward rule changes.
- Production SFU disposable QA: official `@livekit/rtc-node 1.1.0` and `livekit-server-sdk 2.19.0`; two participants, 77 received synthetic audio frames; listener denial, promotion, actual received audio, self mute/unmute, staff revoke, staff-lift-without-auto-publish, explicit unmute, leave/reseat all passed. No duplicate participant. Disposable room deleted.
- Exact signed APK installed on Android 16, package `com.nazraa.live`, build 7395. Controlled ordinary-account Party created; 10→20→10 settings saved without losing microphone publication. Server-side read-only checks confirmed both MySQL `muted` and the actual LiveKit audio track changed true→false with the same participant connected and microphone capability retained. No LiveKit/Redis restart.
- Exact account was not Face-verified, so its room chat restriction was correctly retained, not bypassed. Multiple-message visibility/autoscroll is covered by widget tests; this is not a claim of a new physical-device multi-user listening test.

## Deployment and preservation

Only the API container was replaced. Existing source overlays preserved. No migration needed. Fresh encrypted offsite backup verified: `nazraa-nightly-20261015T080437Z`, 4,863,036,471 bytes. Rollback source and previous image protected in `/opt/nazraa/backups/release-2.4.83` and `nazraa-api:rollback-before-2.4.83`.

Website and GitHub now serve 2.4.83. Full public APK downloaded and SHA-256 verified on the VPS. Remote latestVersion updated through audited SYSTEM maintenance; minimumVersion remains 2.1.0, maintenance/economy/media settings unchanged. Existing Host payout website, Google origins and sign-in work remain intact.

APK SHA-256: `ca11c8cc7394d93e6d0389925f641f6ddc7745fb659c6f1e4e0fffaa20e4b78b`.

AAB SHA-256: `7bf83f59ed2ba7e17a2cda0d1f39de55b491c4cf0e0626bd347ec13d48748125`.

Signed artifacts and sanitized mobile source archived locally. Full screenshots are private QA files to avoid republishing incidental member names/profile data.
