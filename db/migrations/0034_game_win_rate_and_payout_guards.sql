-- Per-game server odds and payout safety.
-- Shared games still publish one global result to every player. Jungle Hunt
-- remains an individual spin but now honours its 40% profitable-round target.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.targetWinRate', 0.50,
  '$.games.teen_patti_pro.targetWinRate', 0.50,
  '$.games.teen_patti_pro.maximumPayoutMultiplier', 25,
  '$.games.luck77.targetWinRate', 0.50,
  '$.games.luck77.maximumPayoutMultiplier', 8,
  '$.games.greedy_lion.targetWinRate', 0.40,
  '$.games.greedy_lion.maximumPayoutMultiplier', 45,
  '$.games.greedy_king.targetWinRate', 0.40,
  '$.games.greedy_king.maximumPayoutMultiplier', 45,
  '$.games.bounty_football.targetWinRate', 0.40,
  '$.games.bounty_football.maximumPayoutMultiplier', 100,
  '$.games.jungle_hunt.targetWinRate', 0.40,
  '$.games.jungle_hunt.maximumPayoutMultiplier', 20,
  '$.updatedBy', 'server-odds-and-payout-guard'
)
WHERE setting_key = 'mobile.games';
