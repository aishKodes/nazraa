# Real media QA — 12 October 2026

## What was actually tested

The original-package, release-key-signed internal profile build was used with
the existing authorized reviewer Host. It is not a newly published APK.

- Host camera and microphone published through production LiveKit.
- Face was open over an hour and crossed 3,600 authoritative eligible seconds.
  The same durable session `33603760-02bd-4a2e-87b8-b7a38db97314` generated exactly
  one **unclaimed** 3,500-Diamond entitlement at 17:29:57 UTC, source
  `HOST_HOURLY_DIAMONDS`. No automatic Diamond credit or rule change was made.
- A separately authenticated production QA viewer connected normally, received
  camera and audio, and could not publish before Host acceptance.
- Actual first video frame was 720 × 1280, not inferred from configuration.
  One inbound sample measured 9 FPS on this constrained emulator, 48 ms RTT,
  two cumulative video packets lost and zero audio packets lost. This is not a
  claim of production-phone FPS or p50/p95 performance.
- The Host accepted the viewer's audio request through the Android UI. The
  viewer published microphone only and stayed connected for over six minutes.
- Wi-Fi/cellular were disabled at 17:32:16 UTC and restored at 17:34:20 UTC:
  **124 seconds**, not the originally planned 70. The same accounting ID stayed
  active, publishing resumed, and the entitlement count stayed one.
- Post-recovery independent viewer again received microphone and a decoded
  720 × 1280 first frame. The QA room was then closed through the real app UI.

## Local source verification, not equivalent to two-Host runtime QA

- Flutter analyze: zero issues; full suite: 244 passed.
- Six focused tests: old renderer disposal reproduced; one primary renderer
  state survived 20 widget PK cycles; pending connections coalesced; failed
  connection recovered; Google native cleanup preceded new auth; LiveKit beauty
  never called an absent ZEGO engine.
- Direct APK package and SHA-1 matched the actual registered Android OAuth
  client in the correct owner Google Cloud project. Backend Web-client audience
  allowlist matches the mobile Web client. No credentials were rotated.

## Remaining gates / access limitations

- The viewer account correctly returned 403 when asked to create a Host room.
  A second already-verified Host is required for real 20-cycle PK, remote video
  and cross-audio tests. Widget cycles are not reported as that runtime PASS.
- Twenty actual Google login/account-switch scenarios and meaningful cold
  launch/Home/Face p50/p95 measurements are not yet complete.
- Both logged-in owner accounts reached Play Console signup rather than the
  existing developer account. Play App Signing registration is unverified.
- The VPS has zero signed LiveKit media-event rows. Webhook credentials match
  token credentials, but the OCI destination/config must be inspected; direct
  SSH to the existing OCI VM still times out. Heartbeat accounting works, but
  this is a genuine media-evidence gap, not a proven webhook PASS.
- Some final Flutter changes (especially legacy beauty isolation) are source
  and unit-tested but not in this running profile artifact. A final mobile
  build/release remains gated; existing public 2.4.77+7389 is not replaced.

No account verification was forged, no user role was elevated to manufacture QA,
and no economy, LiveKit routing, DNS or firewall policy was changed by these tests.
