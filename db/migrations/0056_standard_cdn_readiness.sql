-- Activation-safe configuration for ZEGO standard Live Streaming/CDN.
-- Paid routing and Stream Mixing deliberately remain disabled until the
-- project/domain activation checklist has been completed.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackMode', 'rtc_fallback',
  '$.partyPassivePlaybackMode', 'dynamic_rtc_fallback',
  '$.passivePlaybackResourceMode', 'cdn',
  '$.passiveEventDelaySeconds', 5,
  '$.paidMediaRoutingEnabled', FALSE,
  '$.streamMixingEnabled', FALSE,
  '$.pkCompositeStreamingEnabled', FALSE,
  '$.emergencyRtcFallbackEnabled', FALSE,
  '$.rtcPassiveFallbackCeiling', 3,
  '$.updatedBy', 'standard-cdn-ready-awaiting-zego-activation'
)
WHERE setting_key = 'mobile.room_features';
