# Nazraa Live 2.4.93 (7405)

- Fix recoverable LiveKit cleanup being mistaken for leaving a room, and fix a
  camera-switch beauty-buffer lifetime crash.
- Preserve canonical Live time across rebuilds and improve signed publishing
  evidence and claimable-reward reconciliation. Reward rules are unchanged.
- Stronger device-local beauty: protected-feature smoothing, skin-tone evening,
  under-eye correction, lips and relighting, with a lighter fallback.
- Add verified, remotely managed PAG effect support using the existing
  game-safe compact queue. New PAG artwork can be uploaded separately.
- Support Princess visible first-card rounds with explicit committed per-chair
  quotes when enabled by Master. No hidden wager-dependent deals; legacy and
  historical payout records remain intact.
- About now identifies the exact source commit and build timestamp.

Package and permanent signing certificate are unchanged. Current LiveKit
infrastructure, Party seats, wallets, other games and payout records are retained.
