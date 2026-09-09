-- Server-authoritative Face Live hours and gender-based hourly rewards.
-- Party Audio remains governed by its existing independent rules.

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.live_rules', JSON_OBJECT(
  'timezone', 'Asia/Kolkata',
  'startTime', '08:00',
  'endTime', '01:00',
  'closingNoticeMinutes', 15,
  'rewardEnabled', TRUE,
  'femaleHourlyRewardDiamonds', 3500,
  'maleHourlyRewardDiamonds', 0,
  'agencyAuthorizationRequired', TRUE,
  'updatedBy', 'live-business-policy-0063'
), id
FROM platform_accounts
WHERE role = 'MASTER'
ORDER BY created_at
LIMIT 1
ON DUPLICATE KEY UPDATE
  setting_value = JSON_MERGE_PATCH(setting_value, VALUES(setting_value)),
  updated_by = VALUES(updated_by);

UPDATE host_reward_rules
SET coins_per_hour = CASE WHEN room_type = 'PARTY' THEN 0 ELSE 3500 END,
    minimum_eligible_seconds = CASE WHEN room_type = 'PARTY' THEN minimum_eligible_seconds ELSE 3600 END
WHERE enabled = TRUE;

-- An approved Agency owner is also a Host. Repair only missing legacy links;
-- never overwrite membership or moderation state.
UPDATE application_users user
INNER JOIN platform_accounts agency
  ON agency.role = 'AGENCY' AND agency.status = 'ACTIVE'
 AND (agency.application_user_id = user.id
   OR agency.application_user_id = user.external_user_id
   OR agency.application_user_id = CAST(user.public_id AS CHAR))
SET user.is_host = TRUE,
    user.agency_account_id = COALESCE(user.agency_account_id, agency.id);

INSERT IGNORE INTO host_profiles
  (id, application_user_id, agency_account_id, status, verification_status)
SELECT UUID(), user.id, agency.id, 'ACTIVE',
       CASE WHEN user.face_verification_status = 'VERIFIED' THEN 'VERIFIED' ELSE 'UNVERIFIED' END
FROM application_users user
INNER JOIN platform_accounts agency
  ON agency.role = 'AGENCY' AND agency.status = 'ACTIVE'
 AND (agency.application_user_id = user.id
   OR agency.application_user_id = user.external_user_id
   OR agency.application_user_id = CAST(user.public_id AS CHAR));

UPDATE host_profiles host
INNER JOIN application_users user ON user.id = host.application_user_id
INNER JOIN platform_accounts agency
  ON agency.role = 'AGENCY' AND agency.status = 'ACTIVE'
 AND (agency.application_user_id = user.id
   OR agency.application_user_id = user.external_user_id
   OR agency.application_user_id = CAST(user.public_id AS CHAR))
SET host.agency_account_id = agency.id
WHERE host.agency_account_id IS NULL;

CREATE TABLE IF NOT EXISTS live_hour_reward_decisions (
  id CHAR(36) PRIMARY KEY,
  live_session_accounting_id CHAR(36) NOT NULL,
  completed_hour INT UNSIGNED NOT NULL,
  host_application_user_id CHAR(36) NOT NULL,
  authoritative_gender VARCHAR(32) NULL,
  eligible BOOLEAN NOT NULL,
  reward_diamonds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  decision_reason VARCHAR(80) NOT NULL,
  ledger_transaction_id CHAR(36) NULL,
  decided_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_hour_decision_accounting FOREIGN KEY (live_session_accounting_id) REFERENCES live_session_accounting(id),
  CONSTRAINT fk_live_hour_decision_host FOREIGN KEY (host_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_hour_decision_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_live_hour_reward_decision (live_session_accounting_id, completed_hour),
  INDEX idx_live_hour_reward_host (host_application_user_id, decided_at),
  CHECK (completed_hour >= 1),
  CHECK ((eligible = TRUE AND reward_diamonds > 0) OR (eligible = FALSE AND reward_diamonds = 0))
) ENGINE=InnoDB;

UPDATE policy_documents
SET body_json = JSON_SET(
  body_json,
  '$.sections[2].rules[0]',
  'Eligible female Hosts earn 3,500 Diamonds for each completed continuous 60-minute Face Live block. Male and other Hosts may stream normally but receive no Live-time reward. Party Audio earns no hourly reward.'
)
WHERE policy_key = 'host-live-access' AND active = TRUE;
