-- Nazraa exposes exactly two live experiences: Party Audio and Face Live.
-- Retire the historical LIVE/video-call value without deleting history.

UPDATE live_rooms
SET room_type = 'FACE'
WHERE room_type = 'LIVE';

UPDATE live_session_accounting
SET room_type = 'FACE'
WHERE room_type = 'LIVE';

UPDATE live_room_members member
INNER JOIN live_rooms room ON room.id = member.room_id
SET member.media_role = CASE
  WHEN member.room_role = 'OWNER' THEN 'HOST'
  WHEN member.room_role = 'SPEAKER' THEN 'AUDIO_GUEST'
  WHEN member.media_role = 'AUDIO_REQUESTED' THEN 'AUDIO_REQUESTED'
  ELSE 'PASSIVE_VIEWER'
END
WHERE room.room_type = 'FACE';

-- Old accounting rows retain their reward-rule FK, but no new room can select
-- the retired LIVE rule. The single visible Face rule remains authoritative.
UPDATE host_reward_rules
SET enabled = FALSE
WHERE room_type = 'LIVE' AND enabled = TRUE;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.videoLiveEnabled', FALSE,
  '$.faceLiveEnabled', TRUE
)
WHERE setting_key = 'mobile.features';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.18',
  '$.latestBuild', 5328
)
WHERE setting_key = 'mobile.app_config';
