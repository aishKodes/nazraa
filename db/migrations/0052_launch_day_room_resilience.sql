-- Keep an active broadcaster's authoritative reward clock intact through a
-- normal mobile handoff or short API outage. Room cleanup has a separate,
-- longer safety window and still finalizes earned full hours server-side.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.mediaReconnectGraceSeconds', 180,
  '$.roomStaleGraceSeconds', 300,
  '$.updatedBy', 'launch-day-room-resilience'
)
WHERE setting_key = 'mobile.room_features';
