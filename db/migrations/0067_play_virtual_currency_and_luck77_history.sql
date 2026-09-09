-- Play-v1 presentation cleanup: the public mobile configuration must describe
-- Diamond exchange only as an internal virtual-currency conversion, and
-- Luck77 must expose enough completed outcomes for informed next-round bets.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.currency', 'COINS'
)
WHERE setting_key = 'economy.diamond_conversion';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.games.luck77.historyLength', 6
)
WHERE setting_key = 'mobile.games';
