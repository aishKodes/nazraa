-- A qualifying Host earns one claimable daily first-hour reward regardless of
-- gender.  The durable daily guard, hourly decisions and ledger source stay
-- unchanged; this migration changes only the policy configuration.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.hourlyRewardDiamonds',
    CAST(COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.hourlyRewardDiamonds')),
      JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.femaleHourlyRewardDiamonds')),
      '3500'
    ) AS UNSIGNED),
  '$.femaleHourlyRewardDiamonds',
    CAST(COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.hourlyRewardDiamonds')),
      JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.femaleHourlyRewardDiamonds')),
      '3500'
    ) AS UNSIGNED),
  '$.maleHourlyRewardDiamonds',
    CAST(COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.hourlyRewardDiamonds')),
      JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.femaleHourlyRewardDiamonds')),
      '3500'
    ) AS UNSIGNED),
  '$.rewardEligibility', 'ALL_ELIGIBLE_HOSTS',
  '$.rewardFrequency', 'DAILY_FIRST_ELIGIBLE_HOUR',
  '$.maximumRewardsPerBusinessDay', 1,
  '$.updatedBy', 'all-eligible-hosts-live-reward-0072'
)
WHERE setting_key = 'mobile.live_rules';

UPDATE policy_documents
SET body_json = JSON_SET(
  body_json,
  '$.sections[2].rules[0]',
  'Every eligible Host earns one claimable 3,500-Diamond reward per business day after completing the first continuous 60-minute Face Live block. Additional Live time that day does not create another duration reward. Party Audio earns no hourly reward.'
)
WHERE policy_key = 'host-live-access' AND active = TRUE;
