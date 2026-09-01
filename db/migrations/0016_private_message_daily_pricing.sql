-- Server-day private-message pricing. A sender pays for the first configured
-- number of successfully stored messages each database day; later sends are
-- free until CURRENT_DATE changes on the server.

CREATE TABLE IF NOT EXISTS private_message_daily_usage (
  application_user_id CHAR(36) NOT NULL,
  usage_date DATE NOT NULL,
  paid_message_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  total_message_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (application_user_id, usage_date),
  CONSTRAINT fk_private_message_daily_user
    FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_private_message_daily_date (usage_date, paid_message_count)
) ENGINE=InnoDB;

-- Preserve sends already made earlier on the migration day so deployment
-- cannot accidentally give an additional paid quota.
INSERT INTO private_message_daily_usage
  (application_user_id, usage_date, paid_message_count, total_message_count)
SELECT sender_application_user_id, CURRENT_DATE,
       LEAST(COUNT(*), 20), COUNT(*)
FROM private_messages
WHERE created_at >= CURRENT_DATE
  AND created_at < DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY)
GROUP BY sender_application_user_id
ON DUPLICATE KEY UPDATE
  paid_message_count = VALUES(paid_message_count),
  total_message_count = VALUES(total_message_count);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.social',
       JSON_OBJECT(
         'private_message_coin_cost', 10,
         'private_message_daily_paid_limit', 20
       ),
       id
FROM platform_accounts
WHERE role = 'MASTER'
ORDER BY created_at
LIMIT 1
ON DUPLICATE KEY UPDATE
  setting_value = JSON_SET(
    setting_value,
    '$.private_message_coin_cost', 10,
    '$.private_message_daily_paid_limit', 20
  );
