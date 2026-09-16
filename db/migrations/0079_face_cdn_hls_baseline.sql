-- Standard Face CDN remains HLS until a controlled same-stream Android FLV
-- comparison proves a better route.  This adjusts only the remote delivery
-- preference; it does not alter Live Streaming, Stream Mixing, Party hybrid,
-- RTC safeguards, or the L3 gate.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackProtocol', 'hls',
  '$.updatedBy', 'face-cdn-hls-baseline'
)
WHERE setting_key = 'mobile.room_features';
