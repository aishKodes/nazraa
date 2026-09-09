-- Dedicated, non-financial Live-reward QA controls and immutable probe records.
-- These fields are never read from a mobile request. A MASTER may enable them
-- only for an active dedicated Play-review Host, for a short expiry window.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'mobile_access_overrides' AND COLUMN_NAME = 'live_reward_qa_enabled') = 0,
  'ALTER TABLE mobile_access_overrides ADD COLUMN live_reward_qa_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER play_reviewer_access_override, ADD COLUMN live_reward_qa_threshold_seconds SMALLINT UNSIGNED NULL AFTER live_reward_qa_enabled, ADD COLUMN live_reward_qa_expires_at DATETIME(3) NULL AFTER live_reward_qa_threshold_seconds, ADD INDEX idx_live_reward_qa_expiry (live_reward_qa_enabled, live_reward_qa_expires_at)',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

CREATE TABLE IF NOT EXISTS live_reward_qa_runs (
  id CHAR(36) PRIMARY KEY,
  live_session_accounting_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  threshold_seconds SMALLINT UNSIGNED NOT NULL,
  observed_eligible_seconds INT UNSIGNED NOT NULL,
  outcome ENUM('WOULD_CREATE_NON_FINANCIAL') NOT NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_reward_qa_session FOREIGN KEY (live_session_accounting_id) REFERENCES live_session_accounting(id),
  CONSTRAINT fk_live_reward_qa_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  UNIQUE KEY uq_live_reward_qa_session (live_session_accounting_id),
  INDEX idx_live_reward_qa_completed (completed_at),
  CHECK (threshold_seconds BETWEEN 60 AND 180)
) ENGINE=InnoDB;
