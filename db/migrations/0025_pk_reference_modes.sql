-- Publish the verified Vyno-style PK choices without changing session/wallet
-- architecture. Invite/Friends uses the active eligible-host directory.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.pkDurations', JSON_ARRAY(2, 5, 10),
  '$.pkModes', JSON_ARRAY('Classic', 'Auto PK', 'Random', 'Invite/Friends')
)
WHERE setting_key = 'mobile.room_features';

