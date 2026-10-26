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

The current SignalClient assigns `_ws` only after awaiting `connector.timeout(...)`. Timeout does not cancel the underlying connection; a later socket has shared callbacks but no `_ws` reference, so cleanup cannot close it. The official upstream report describes the same mechanism: https://github.com/livekit/client-sdk-flutter/issues/1219 . A separate open teardown/reconnect issue is https://github.com/livekit/client-sdk-flutter/issues/1245 . These reports are corroboration, not proof that every historical Nazraa incident had that cause. A deterministic local regression will exercise the actual vendored implementation.

## Approved reward interpretation

Owner explicitly confirmed: **claimable Diamonds**, 1,750 at each qualifying 1,800-second block, maximum two blocks / 3,500 Diamonds per server reward day. Rewards still requires Claim. No automatic wallet credit, gender/eligibility change, or gifting/game/economy redesign. Completed historical awards/claims remain immutable; existing full-day awards must exhaust the new daily budget rather than pay twice.

Implementation and production/runtime evidence follow below when verified. The existing public release is retained until the new release gates pass.
