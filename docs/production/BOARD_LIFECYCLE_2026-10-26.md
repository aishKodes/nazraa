# Board lifecycle and half-hour rewards — 26 October 2026

Baseline: public Android 2.5.06+7418, Flutter commit 13cda67594d0; backend stabilized at 8347b35 plus website/version publication. No SDK migration is assumed.

## Termination audit before implementation

| Trigger / source | Existing effect | Application-terminal? | Decision |
|---|---|---|---|
| Explicit Face Host End / Party Close | Canonical finalizer, durable ledger, route exit | Yes | Keep |
| Explicit audience exit / join cancellation | Local route/transport cleanup; no Host finalization | Intentional local exit | Keep |
| Owner Party Exit with authorized admin | Transfers owner; keeps board alive | No global end | Keep |
| DB room status ENDED / authorized delete | Presence returns `terminal:true`, coordinator exits | Yes | Keep |
| Backend ban, kick, block, access revocation | Rejects membership/token; moderation calls DeleteRoom/RemoveParticipant | Yes, when application-authorized | Keep |
| Face schedule closure | Server finalizer with schedule reason | Existing product policy | Keep |
| Abandoned stale Host | SFU absence + locked heartbeat/evidence recheck | Only confirmed expiry | Preserve existing server proof; no timeout-only patch |
| LiveKit `roomDeleted` | Client directly sets streaming ended | Not sufficient application proof | Recover/reconcile application authority |
| LiveKit `duplicateIdentity` | Client directly sets logout/ended | Not sufficient ownership proof | Require authoritative publishing-grant/session check |
| LiveKit `participantRemoved` | Client sets removed state; Face refreshes backend | Requires application membership proof | Reconcile; enforce real moderation |
| Unknown/timeout/stateMismatch/signal loss | Bounded media rebuild loop | No | Retain application/session and retry transport |
| First token/connect exception | Releases transport, FAILED startup/manual retry | No | Reuse bounded startup recovery |
| Connected camera/mic startup failure | Returns false; manual retry | No | Retry missing publication, retain healthy Room |
| Camera/Beauty/renderer watchdog | Restarts smallest component / Beauty fallback | No | Preserve |
| Participant/track churn during full reconnect | Existing room-object/generation checks; transitional membership ignored | No | Preserve |
| Audience events | Presence/render subset only | No | Preserve |
| Background / phone call | Pauses publishing evidence and native tracks | No | Preserve recovery/intent |
| Presence/heartbeat API exception | Keeps last snapshot, retry indication | No | Preserve |
| Presence `active:false,terminal:false` | Authorized rejoin, same application room | No | Preserve |
| Widget disposal / explicit room switch | Ends local transport generation | Local ownership cleanup only | Preserve stale-generation protection; never infer backend end |
| Secondary PK bridge disposal | Disconnects only bridge subscriber | No | Preserve isolation |
| Modal Navigator.pop / effect/music controller dispose | Closes local sheet/effect only | No | No change |
| Signed participant_left/track_unpublished webhook | Updates media evidence; no DeleteRoom/finalize | No | Preserve |
| room_finished/connection_aborted webhook | Not accepted as session-end command | No | Preserve |
| Provider interruption lasting >30s | Existing Auto Resume code promotes it to quota-consuming interruption | Not necessarily application interruption | Separate foreground transport recovery from application absence |

App presence repository was inspected: only explicit backend `terminal:true` returns null; transient errors throw and do not close the board. Room/session clocks are not reset by presence refresh. Old ZEGO implementations remain dormant and are not the active production media path.

## SDK investigation

Installed LiveKit Flutter **2.5.3+nal1**, Flutter WebRTC **1.2.0**, Android WebRTC **137.7151.04**. The isolated SDK branch uses 2.13.1 and contains the same `Future.timeout`/unowned late-WebSocket pattern. No blind upgrade.

The baseline SignalClient assigned `_ws` only after awaiting `connector.timeout(...)`. Timeout does not cancel the underlying connection; a later socket had shared callbacks but no `_ws` reference, so cleanup could not close it. The official upstream report describes the same mechanism: https://github.com/livekit/client-sdk-flutter/issues/1219 . A separate teardown/reconnect report is https://github.com/livekit/client-sdk-flutter/issues/1245 . These reports corroborate the deterministic local reproduction; they do not prove that every historical Nazraa incident had that cause.

## Approved reward interpretation

Owner explicitly confirmed: **claimable Diamonds**, 1,750 at each qualifying 1,800-second block, maximum two blocks / 3,500 Diamonds per server reward day. Rewards still requires Claim. No automatic wallet credit, gender/eligibility change, or gifting/game/economy redesign. Completed historical awards/claims remain immutable; existing full-day awards must exhaust the new daily budget rather than pay twice.

## Implemented lifecycle corrections

- All raw LiveKit disconnect reasons enter bounded transport recovery. Actual Nazraa end/removal/account revocation/replacement is still enforced through typed backend authority. Existing room/generation/track ownership and moderation checks remain.
- Initial token/connect failures retry the failed transport stage within the same board. Camera and microphone publication are attempted independently; a healthy connected Room is retained while missing publication is retried. Existing Beauty fail-open behavior is preserved.
- The vendored SignalClient owns each socket attempt, closes late timeout results, and ignores superseded callbacks. Deterministic regression: late socket close count was 0 before the fix, 1 after. Dispose-in-flight and stale-successor callback tests also pass.
- Recovery backoff is a cancellable owned timer. The Flutter tests exposed and then verified removal of a disposed-room pending timer.
- Self-mute is separate from publishing authorization. A muted accepted audio Guest retains the audio-only capability; staff mute still revokes it. A staff-muted Face Host retains camera-only capability. A real newer authenticated Host session causes the obsolete caller to receive an authoritative replacement verdict.
- The existing controller now exposes the canonical application lifecycle without adding another clock. Transport recreation preserves its application session/generation, desired controls and server-time clock.

## SDK audit

| Component | Exact candidate version |
|---|---|
| Flutter | 3.44.9 / Dart 3.12.2 |
| LiveKit Flutter | 2.5.3+nal2 (scoped vendored socket ownership fix) |
| Flutter WebRTC | 1.2.0 |
| Android WebRTC | 137.7151.04 |

The isolated 2.13.1 branch contains the same late-socket pattern, so this is a confirmed local fix rather than an unproven SDK migration. The installed SDK does not expose ConnectionCheck; no diagnostic suite was added to startup. Safe bounded local traces retain raw disconnect categories, but tokens/URLs and media contents are excluded.

## Production configuration and accounting

On 26 October the actual existing SFU rooms reported departure **20s**, empty **300s**. A new Face and Party room created through the production token flow reported departure **240s**, empty **300s**. Nazraa auto-creates on first join; no precreation or global LiveKit restart was introduced.

The remote mobile transport grace was actually **300s**, while canonical Auto Resume was **180s**. Only `mobile.room_features.mediaReconnectGraceSeconds` was audited/aligned to **180s**. The server daily quota stays five successful application restorations. Same-process internal transport recovery does not consume it. A changed process also counts a fast restoration before a delayed provider departure, excluding that unobserved interval.

Migration `0110_live_reward_blocks.sql` adds period snapshots and two unique Host/day award slots. Production activation sets 1800 seconds, two 1750-Diamond claimable blocks / 3500 maximum per server business day. It adopted 432 active undecided sessions. No historical award/claim was rewritten. Existing decided sessions retain their historical snapshot. Party reward economics and the existing one-hour Face Valid Day are unchanged.

Production rollback-only canonical-engine probe: 1799 → 0; 1800 → 1750; 3599 → 1750; 3600 → 3500; repeat 3600 → 3500. All entitlements UNCLAIMED, no wallet credit, and all synthetic records rolled back. Real post-activation production entitlements and manual claims were also observed; an aggregate integrity query found zero daily-cap violations.

Concurrent empty/repeated claims exposed a shared duplicate-key wallet-lock upgrade deadlock. Existing wallets now take their exclusive point lock directly, and DB-idempotent claims retry rolled-back deadlocks. Eight concurrent settlements/claims plus 32 empty repeats produce exactly two credits / 3500 Diamonds. Missing-entitlement repair preserves the original period snapshot as well as amount.

Session history continues up to the existing seven-day safety bound; the two-unit limit is per reward day, not a lifetime session cap. Same-session midnight fixtures verify two blocks on each of two days. A new process within 10s uses one Auto Resume, without crediting that gap. Completed blocks survive expired recovery; only the incomplete remainder resets.

Accounting precision remains the existing server evidence policy: current clients checkpoint approximately every 20s, with a bounded 30s evidence window. It is not frame-level accounting. Unknown/offline gaps beyond the supported interval are excluded; detection/transport boundaries can carry that bounded uncertainty. No device wall-clock elapsed value determines rewards.

## Verification and release gate status

- Flutter analyze: clean. Full Flutter suite: 485 passed.
- Backend full core regression, role matrix, legacy Auto Resume and new block/recovery fixtures passed. Fixture coverage includes 179/180/181s, five-use quota, duplicate/out-of-order signals, process recreation, immediate close crossing either block threshold, Bangladesh male eligibility, two-session contention, immutable old full-day award, daily rollover and manual Claim idempotency.
- Exact signed APK 2.5.07+7419: 20/20 Face starts and 20/20 Party starts. Server observer independently confirmed expected tracks for every cycle; Face advertised 1280×720 (rotated 720p equivalent). All new observed rooms: departure 240, empty 300.
- UIAutomator observed ready p50/p95: Face 10.669/12.937s, Party 7.078/8.275s. These include test-driver observation overhead and are not clean tap-to-frame benchmarks.
- Party real Android default-network removal: 10/30/60s, all automatically recovered in the same board. Corresponding recovery observations including test-driver overhead: 13.13/13.89/15.06s.
- Exact-APK Face soak: **3905 seconds / 65:05**, passed. Start 26 October 14:58:25 UTC; explicit close returned Home. Final visible clock **61:08**, followed by normal close processing; final durable committed publishing time **3686 seconds / 61:26**. Offline/background/recovery intervals were excluded. The Live clock continued after the daily reward cap. All 64 samples retained the same board; PSS range 220,627–242,758 KB, with no sustained growth.
- Face outages: actual Android default network removed for **10.07 / 30.21 / 60.11s**. Automatic recovery observed in **3.57 / 8.26 / 7.78s** after restoration (test-driver overhead included). Camera rotation, mic mute/unmute, 30s background/resume, 15s incoming-call simulation and Beauty-panel checks passed.
- Controlled SFU-only deletion: guard verified the QA Host was the sole participant. **5.054s** later, a new RTC room SID had republished camera/mic, while Nazraa application session, earned time and Auto Resume quota were unchanged. New transport still departure 240 / empty 300. No backend finalizer was called for this test.
- Real production QA session: **two UNCLAIMED 1750-Diamond entitlements**, total **3500**, zero reward wallet credits, zero duplicate/cap violations. Normal explicit close finalized its ledger. Completed financial/audit records were retained.
- Final deployed-code production probe also passed fast-process restoration (zero restart-gap credit), same-session daily rollover, all four reward thresholds and repeat settlement. All probe records were rolled back.
- **Published 2.5.07+7419** on GitHub and `https://nazralive.in/download`. The public APK was downloaded, hash-matched byte-for-byte, installed without uninstalling, and smoke-tested: existing login retained, Face camera/mic 720p publication, Live clock after the reward cap, Party signed audio evidence and normal closes. Public AAB independently streamed/hash-verified. Zero active QA application rooms and zero QA RTC participants remained.
- Remote latest: **2.5.07+7419**. Existing minimum **2.1.0** and other app configuration preserved. Host Rules copy version **1.1** accurately describes claimable half-hours; prior version retained, other sections and UGC acceptance requirements unchanged.

Rollback: verified existing private OCI predeploy backup, source archives and pre-deploy API images are retained. Only API was recreated; MySQL, Redis, worker, realtime and LiveKit were not restarted. Production-only Control copy was preserved after a source guard detected the difference. Deployment manifests under `/opt/nazraa/tools/` record the exact selected source commits; no hard reset of the production checkout occurred.

Released mobile commit: `1f2677345c3583dc601fe65d3cc7204e2c1d1c11`. Selected deployed backend source: `ca9ce48add8d759aedcc68b5ac728dc8fbd41328`. Package and permanent release certificate unchanged. Exact public APK: 259,196,678 bytes; AAB: 204,592,304 bytes.

APK SHA-256: `d6ccaed54c20d04e30aab9cd7231aff511d7414f288c1ac9e72e6e23541d5cfb`.
AAB SHA-256: `49b73bc7afc43449c2a77a2ae248689f7dadcf433483c6e3cffd901ab2f0a551`.

No physical phone was available. Emulator Wi-Fi/mobile-interface and call simulations do not certify real carrier/device behavior.

Production evidence files: `/opt/nazraa/logs/board-2.5.07-release-gates.json`, `board-final-production-probe-20261026.json`, `board-controlled-rtc-reset-20261026.log`, `board-public-smoke-cleanup-20261026.json`. Deployment/rollback manifests remain under `/opt/nazraa/tools/`. Private local QA logs are stored beside the release artifacts in the mobile workspace's ignored `dist/board-lifecycle-2.5.07/qa/` directory.
