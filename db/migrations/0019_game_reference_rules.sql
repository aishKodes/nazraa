-- Current launch game economy. Outcomes remain generated and settled only on
-- the server, and every payout is tied to an immutable client round ID.
SET @nazraa_game_master_id := (
  SELECT id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT
  'mobile.games',
  JSON_OBJECT(
    'targetWinRate', 0.60,
    'winningsDeductionRate', 0.01,
    'updatedBy', 'reference-video-alignment'
  ),
  @nazraa_game_master_id
WHERE @nazraa_game_master_id IS NOT NULL
ON DUPLICATE KEY UPDATE setting_value = JSON_SET(
  setting_value,
  '$.targetWinRate', 0.60,
  '$.winningsDeductionRate', 0.01,
  '$.updatedBy', 'reference-video-alignment'
);
