# Nazraa Live 2.4.87+7399 — Lucky 77 test build

Signed APK for owner testing; production API and normal accounts, not demo
balances. This prerelease does not replace the stable website download.

- RESULT remains live while open and shows the latest 20 actual unique rounds.
- Missing events, reconnect/resume and delayed settlement recover promptly.
- Server-time ordering fixes older, larger round numbers hiding newer results
  after a configured round-duration change.
- Larger recent-result icons, clearer history grid and refined wheel details.
- Existing multi-area betting, wallet, odds and payout rules are preserved.
- Previously completed compact Teen Patti Princess/result presentation is
  included; Teen Patti Pro and media architecture are unchanged.

Reference clarification: the supplied video can award extra fruit winners on
special 77 rounds. Nazraa's current base game has one winning area. The video
does not provide the required bonus probabilities/accounting; no guessed bonus
rules have been enabled.

Automated checks: Flutter analysis clean; all 343 tests pass. Isolated database
checks: 30 rounds, 48 settlements, no duplicate debits/settlements or missing
history. No production financial fixture was created.
