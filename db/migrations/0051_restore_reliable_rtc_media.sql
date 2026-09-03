-- Restore the known-working RTC delivery path until ZEGO confirms that Live
-- Streaming/CDN and server stream mixing are active for this exact project.
-- This changes transport selection only; room roles and application features
-- continue to be authorized by the Nazraa backend.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackMode', 'rtc_fallback',
  '$.partyPassivePlaybackMode', 'dynamic_rtc_fallback',
  '$.streamMixingEnabled', FALSE,
  '$.pkCompositeStreamingEnabled', FALSE,
  '$.updatedBy', 'restore-reliable-rtc-media'
)
WHERE setting_key = 'mobile.room_features';
