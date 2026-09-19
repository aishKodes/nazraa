-- Keep the remotely configured initial Beauty strength in step with the
-- full-resolution LiveKit pipeline.  Existing host-selected profiles remain
-- untouched; Flutter only reads this value when no saved choice exists.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.nazraaNaturalBeautyDefaultStrength', 78,
  '$.updatedBy', 'livekit-full-resolution-beauty-720p'
)
WHERE setting_key = 'mobile.room_features';
