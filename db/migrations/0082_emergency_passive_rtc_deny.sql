-- Emergency billing containment: ZEGO charges RTC participant time for a
-- joined audience member even when the member is muted and plays no stream.
-- Passive Face viewers and Party listeners must use authenticated CDN output.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackMode', 'live_streaming',
  '$.partyPassivePlaybackMode', 'live_streaming',
  '$.partyStreamingThreshold', 1,
  '$.passiveRtcAllowed', FALSE,
  '$.maxGlobalRtcParticipants', 24,
  '$.mediaPublishingEnabled', TRUE,
  '$.paidMediaRoutingEnabled', TRUE,
  '$.streamMixingEnabled', TRUE,
  '$.emergencyRtcFallbackEnabled', FALSE,
  '$.temporaryRtcCostGuardEnabled', TRUE,
  '$.updatedBy', 'emergency-passive-rtc-deny'
)
WHERE setting_key = 'mobile.room_features';

-- Mark any outstanding passive grants revoked. The deployed authorization
-- guard prevents replacement grants for all current and legacy APK versions.
UPDATE live_media_access_grants
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3))
WHERE revoked_at IS NULL
  AND can_publish = FALSE
  AND transport = 'RTC_PASSIVE_FALLBACK';
