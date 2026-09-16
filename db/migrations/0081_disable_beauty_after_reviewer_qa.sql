-- Reviewer-only natural-beauty QA has completed.  Keep the global switch and
-- the reviewer switch off until an operator deliberately starts another
-- controlled review from Master Control.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.nazraaNaturalBeautyEnabled', FALSE,
  '$.nazraaNaturalBeautyReviewerQaEnabled', FALSE,
  '$.updatedBy', 'natural-beauty-reviewer-qa-complete'
)
WHERE setting_key = 'mobile.room_features';
