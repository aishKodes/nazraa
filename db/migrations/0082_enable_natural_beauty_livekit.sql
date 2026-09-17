-- Enable the lightweight, on-device LiveKit beauty pipeline.  The mobile
-- implementation has an immediate pass-through fallback if MediaPipe/GLES is
-- unavailable, and applies its low-end quality tier before attachment, so a
-- failed optional processor can never prevent a Host from publishing.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.nazraaNaturalBeautyEnabled', TRUE,
  '$.nazraaNaturalBeautyLandmarksEnabled', TRUE,
  '$.nazraaNaturalBeautyDefaultStrength', 66,
  '$.updatedBy', 'livekit-natural-beauty-production-default'
)
WHERE setting_key = 'mobile.room_features';
