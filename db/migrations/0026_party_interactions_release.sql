-- Publish the complete supplied Party Board emoji set. Reactions are stored
-- server-side and included in short room-presence snapshots so every member
-- can render the burst above the sender's occupied seat.
INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.room_features', JSON_OBJECT(
  'interactions', JSON_ARRAY(
    JSON_OBJECT('key', 'kiss', 'label', 'Kiss', 'emoji', '💋', 'enabled', TRUE),
    JSON_OBJECT('key', 'love', 'label', 'Love', 'emoji', '💖', 'enabled', TRUE),
    JSON_OBJECT('key', 'hug', 'label', 'Hug', 'emoji', '🤗', 'enabled', TRUE),
    JSON_OBJECT('key', 'heart', 'label', 'Heart', 'emoji', '❤️', 'enabled', TRUE),
    JSON_OBJECT('key', 'cheer', 'label', 'Cheer', 'emoji', '🎉', 'enabled', TRUE),
    JSON_OBJECT('key', 'applause', 'label', 'Applause', 'emoji', '👏', 'enabled', TRUE),
    JSON_OBJECT('key', 'flower', 'label', 'Flower', 'emoji', '🌸', 'enabled', TRUE),
    JSON_OBJECT('key', 'like', 'label', 'Like', 'emoji', '👍', 'enabled', TRUE),
    JSON_OBJECT('key', 'smile', 'label', 'Smile', 'emoji', '😊', 'enabled', TRUE),
    JSON_OBJECT('key', 'star', 'label', 'Star', 'emoji', '⭐', 'enabled', TRUE),
    JSON_OBJECT('key', 'gift', 'label', 'Gift', 'emoji', '🎁', 'enabled', TRUE),
    JSON_OBJECT('key', 'fire', 'label', 'Fire', 'emoji', '🔥', 'enabled', TRUE)
  )
), master.id
FROM platform_accounts master
WHERE master.role = 'MASTER'
ORDER BY master.created_at LIMIT 1
ON DUPLICATE KEY UPDATE
  setting_value = JSON_SET(
    COALESCE(system_settings.setting_value, JSON_OBJECT()),
    '$.interactions',
    JSON_EXTRACT(VALUES(setting_value), '$.interactions')
  ),
  updated_by = VALUES(updated_by);

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.4'
)
WHERE setting_key = 'mobile.app_config';
