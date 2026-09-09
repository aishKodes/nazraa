-- Shorten only the legacy Teen Patti result hold. Preserve any duration that
-- Master has already customized, along with every RTP, wager, and payout rule.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.games.teen_patti_pro.resultSeconds',
  4
)
WHERE setting_key = 'mobile.games'
  AND COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.teen_patti_pro.resultSeconds')),
    '7'
  ) = '7';
