-- Additive only. No historical time, entitlement, wallet or policy rewrites.
CREATE TABLE IF NOT EXISTS live_auto_resume_days (
  host_application_user_id CHAR(36) NOT NULL,
  business_date DATE NOT NULL,
  successful_resumes TINYINT UNSIGNED NOT NULL DEFAULT 0,
  CHECK (successful_resumes <= 5),
  PRIMARY KEY (host_application_user_id, business_date),
  CONSTRAINT fk_auto_resume_host FOREIGN KEY (host_application_user_id) REFERENCES application_users(id)
);
CREATE TABLE IF NOT EXISTS live_session_interruptions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  live_session_accounting_id CHAR(36) NOT NULL,
  host_application_user_id CHAR(36) NOT NULL,
  live_type VARCHAR(8) NOT NULL,
  disconnected_at DATETIME(3) NOT NULL,
  grace_expires_at DATETIME(3) NOT NULL,
  saved_continuous_seconds BIGINT UNSIGNED NOT NULL,
  reward_cycle_version INT UNSIGNED NOT NULL,
  qualifying BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(32) NOT NULL,
  resume_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  resumed_at DATETIME(3) NULL,
  resume_business_date DATE NULL,
  INDEX ix_interruption_session (live_session_accounting_id, disconnected_at),
  INDEX ix_interruption_host_day (host_application_user_id, resume_business_date),
  CONSTRAINT fk_interruption_session FOREIGN KEY (live_session_accounting_id) REFERENCES live_session_accounting(id)
);
ALTER TABLE live_session_accounting
  ADD COLUMN auto_resume_interruption_id CHAR(36) NULL,
  ADD COLUMN reward_cycle_version INT UNSIGNED NOT NULL DEFAULT 0;
