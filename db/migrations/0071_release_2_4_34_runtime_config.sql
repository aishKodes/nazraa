-- Restore the approved Face Live business window and advertise the signed
-- 2.4.34 runtime-hardening candidate. Capture the exact previous JSON in the
-- immutable audit row before changing either remote setting.

SET @nazraa_master_id = (
  SELECT id FROM platform_accounts
  WHERE role = 'MASTER' AND status = 'ACTIVE'
  ORDER BY created_at LIMIT 1
);
SET @nazraa_previous_live_rules = (
  SELECT setting_value FROM system_settings
  WHERE setting_key = 'mobile.live_rules' LIMIT 1
);
SET @nazraa_previous_app_config = (
  SELECT setting_value FROM system_settings
  WHERE setting_key = 'mobile.app_config' LIMIT 1
);

UPDATE system_settings
SET setting_value = JSON_SET(
      COALESCE(setting_value, JSON_OBJECT()),
      '$.timezone', 'Asia/Kolkata',
      '$.startTime', '08:00',
      '$.endTime', '01:00',
      '$.rewardEnabled', TRUE,
      '$.femaleHourlyRewardDiamonds', 3500,
      '$.maleHourlyRewardDiamonds', 0,
      '$.rewardFrequency', 'DAILY_FIRST_ELIGIBLE_HOUR',
      '$.maximumRewardsPerBusinessDay', 1,
      '$.agencyAuthorizationRequired', TRUE
    ),
    updated_by = @nazraa_master_id,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE setting_key = 'mobile.live_rules';

UPDATE system_settings
SET setting_value = JSON_SET(
      COALESCE(setting_value, JSON_OBJECT()),
      '$.latestVersion', '2.4.34',
      '$.latestBuild', 5344
    ),
    updated_by = @nazraa_master_id,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE setting_key = 'mobile.app_config';

INSERT INTO audit_logs
  (id, actor_account_id, actor_role, action, module, target_type, target_id,
   previous_data, new_data, reason)
SELECT UUID(), @nazraa_master_id, 'MASTER',
       'release.runtime_config_update', 'PRODUCT_COMPLETION',
       'MOBILE_RELEASE', '2.4.34+5344',
       JSON_OBJECT(
         'liveRules', JSON_EXTRACT(@nazraa_previous_live_rules, '$'),
         'appConfig', JSON_EXTRACT(@nazraa_previous_app_config, '$')
       ),
       JSON_OBJECT(
         'liveRules', JSON_EXTRACT(setting_live.setting_value, '$'),
         'appConfig', JSON_EXTRACT(setting_app.setting_value, '$')
       ),
       'Restore required 8:00 AM-1:00 AM Face Live window and publish signed 2.4.34 runtime candidate'
FROM system_settings setting_live
JOIN system_settings setting_app
  ON setting_app.setting_key = 'mobile.app_config'
WHERE setting_live.setting_key = 'mobile.live_rules'
  AND @nazraa_master_id IS NOT NULL;
