-- Reliability/pacing follow-up for the 2.4.32 APK. This changes only remote
-- round pacing and presentation metadata; payout tables/RTP are untouched.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.games.teen_patti_pro.bettingSeconds', 12,
  '$.games.teen_patti_pro.drawingSeconds', 4,
  '$.games.teen_patti_pro.resultSeconds', 3,
  '$.games.luck77.bettingSeconds', 8,
  '$.games.luck77.drawingSeconds', 2,
  '$.games.luck77.resultSeconds', 3,
  '$.games.luck77.historyLength', 12,
  '$.games.greedy_lion.bettingSeconds', 16,
  '$.games.greedy_lion.drawingSeconds', 3,
  '$.games.greedy_lion.resultSeconds', 3,
  '$.games.greedy_king.bettingSeconds', 24,
  '$.games.greedy_king.drawingSeconds', 3,
  '$.games.greedy_king.resultSeconds', 3,
  '$.games.bounty_football.bettingSeconds', 8,
  '$.games.bounty_football.drawingSeconds', 3,
  '$.games.bounty_football.resultSeconds', 3
)
WHERE setting_key = 'mobile.games';

-- Supplied square premium frames use a smaller transparent portrait opening
-- than the original simple VIP rings. The renderer reads these values, so
-- future frame artwork can be aligned without another APK.
UPDATE gift_catalog
SET asset_config = JSON_MERGE_PATCH(
  COALESCE(asset_config, JSON_OBJECT()),
  JSON_OBJECT('portraitScale', 0.40, 'portraitOffsetY', -0.02)
)
WHERE catalog_type = 'AVATAR_FRAME'
  AND visual_url LIKE 'Nazraa_Premium_Assets_Pack/%';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.32',
  '$.latestBuild', 5342
)
WHERE setting_key = 'mobile.app_config';
