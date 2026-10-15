# Scoped Party and Agency payout release — 2.4.86+7398

## Implemented scope

- Party: Members at the former upper menu position; single Games icon above the unchanged Rocket dock; icon-only Emoji beside it; Chat/Inbox/Tools then Mic/Gifts/Sound in a compact 3×2 footer. Gift Record is removed only from the Diamond row and remains in Room tools.
- Actual LiveKit VAD/audio-level presentation gate: onset 0.035, sustain 0.015, release 350 ms. Muted tracks immediately clear the indicator. No microphone publication, authorization or mute behavior changed.
- 10 canonical seats: indices 0/1 styled as Couple slots, then eight regular slots. 20 seats: 4×5 regular board with no Couple row. Existing occupied-seat shrink validation and IDs remain intact; no separate Couple toggle.
- Master Withdrawal default is Agency-centric, with full filtered ledger totals rather than totals of a truncated detail page. Agency details remain scoped to saved Agency ownership.
- Master Agency payment workspace records already-made payments against up to 100 explicit existing IDs in one transaction. It reuses the existing payout settlement/reversal engine; it does not initiate a bank transfer or create another payout.
- Canonical decimal USD properties in the existing `withdrawal.economy` setting. Existing legacy fields remain for historical compatibility. Stale old settings forms cannot overwrite canonical rules.
- Future baseline: 125,000 Diamonds → Host USD 10.00 + Agency USD 1.10. Production's existing USD 14.62 gross block value is retained; Company remainder USD 3.52. No other role receives an automatic allocation from the Host web payout.
- Historical payout-rate and Agency snapshots are not rewritten.

## Automated evidence

- Flutter analyze: clean.
- Flutter suite: 307 tests passed, including seven new Party/speech/layout tests.
- Three responsive widths (320/390/430), 10→20→10 layout switching, canonical IDs, occupied high-index shrink guard, silence/mute/speech hysteresis, six control callbacks and unchanged Rocket bounds.
- Party-only golden updated after inspection. Home/Profile baseline checksums remain unchanged.
- Backend core suite passed, including 10 actual isolated QA Hosts: 1.25M Diamonds, USD 100 Host total, USD 11 Agency total, one Agency group; 4 paid / 6 pending; retry-safe batches; immutable prior snapshots after future rate edit; no other-role allocation.
- Built Next HTTP: Master default returns Agency groups and no individual Host rows; scoped drill-down, Agency foreign-scope denial, authentication/origin checks and required batch confirmation passed. No HTTP financial mutation was executed.
- Control integration: 30 groups / 8 roles passed. TypeScript and Next production build passed.
- Production financial writes were not used as test fixtures; all financial mutation assertions used a disposable local QA database.

## Signed artifacts

- APK: `Nazraa-Live-2.4.86-7398-release.apk`, 225328870 bytes.
  SHA-256 `5890d59445208b00b73001225f34b66b4f241f4c073ce14c5a80528bb88b0e07`.
- AAB: `Nazraa-Live-2.4.86-7398-release.aab`, 178393331 bytes.
  SHA-256 `eec420c408525866a53d94c1a8597442e2bd4f17ffa03553380155f10e567137`.
- Permanent signer SHA-256 unchanged: `5e3d3fb10afd21f77c57721b05184453f0061d23e3000416ce409d3ead9367c4`.
- APK/AAB arm64 app code both `d2e5161aee73b3d5be8a3742f07a9aea893dea6e1bca39e3f01ad72b337c4e71`.

## Release operations

Exact APK installed on the existing Android 16 emulator. Runtime/deployment/public-download evidence is appended after verification. Deployment must retain a fresh encrypted offsite backup and full source/image rollback; API only is rebuilt. No LiveKit, Redis, MySQL or realtime service restart is required.

Human voice on/off is not inferred from a static screenshot: the VAD gate/state transitions are tested deterministically against measured SDK event inputs; emulator room controls/layout are checked separately.
