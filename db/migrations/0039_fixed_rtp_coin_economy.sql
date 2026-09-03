-- One shared COIN balance is used for games and social spending. DIAMOND stays
-- separate and is the only host-earnings/withdrawal asset. These fixed odds are
-- selected before betting and never inspect an individual player's wager.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.targetWinRate', 0.50,
  '$.winningsDeductionRate', 0.01,
  '$.games.teen_patti_pro.targetWinRate', 0.50,
  '$.games.teen_patti_pro.targetRtp', 0.95,
  '$.games.teen_patti_pro.payoutScalePpm', 1029014,
  '$.games.teen_patti_pro.sideBetPayoutScalePpm', 1008049,
  '$.games.teen_patti_pro.maximumPayoutMultiplier', 70,
  '$.games.teen_patti_pro.outcomeWeights', JSON_ARRAY(10741, 10001, 10358),
  '$.games.luck77.targetWinRate', 0.50,
  '$.games.luck77.targetRtp', 0.95,
  '$.games.luck77.payoutScalePpm', 1079545,
  '$.games.luck77.maximumPayoutMultiplier', 9,
  '$.games.luck77.outcomeWeights', JSON_ARRAY(1, 4, 4),
  '$.games.greedy_lion.targetWinRate', 0.40,
  '$.games.greedy_lion.targetRtp', 0.95,
  '$.games.greedy_lion.payoutScalePpm', 987317,
  '$.games.greedy_lion.outcomeWeights', JSON_ARRAY(9000, 1000, 1800, 9000, 3000, 9000, 9000, 4500),
  '$.games.greedy_king.targetWinRate', 0.40,
  '$.games.greedy_king.targetRtp', 0.95,
  '$.games.greedy_king.payoutScalePpm', 987317,
  '$.games.greedy_king.outcomeWeights', JSON_ARRAY(9000, 4500, 3000, 1800, 1000, 9000, 9000, 9000),
  '$.games.bounty_football.targetWinRate', 0.40,
  '$.games.bounty_football.targetRtp', 0.95,
  '$.games.bounty_football.payoutScalePpm', 979176,
  '$.games.bounty_football.outcomeWeights', JSON_ARRAY(490000, 196000, 122500, 54444, 14848, 19600, 9800, 11136, 32667, 49000),
  '$.games.jungle_hunt.targetWinRate', 0.40,
  '$.games.jungle_hunt.targetRtp', 0.95,
  '$.games.jungle_hunt.payoutScalePpm', 1008000,
  '$.games.jungle_hunt.maximumPayoutMultiplier', 20,
  '$.games.jungle_hunt.reelSymbols', JSON_ARRAY('gorilla', 'a', 'k', 'q', 'ten'),
  '$.games.jungle_hunt.reelWeights', JSON_ARRAY(1, 1, 1, 1, 1),
  '$.updatedBy', 'fixed-rtp-bet-independent-results'
)
WHERE setting_key = 'mobile.games';
