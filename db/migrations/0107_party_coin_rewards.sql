-- Additive daily reward accounting; never changes existing wallet balances.
CREATE TABLE IF NOT EXISTS party_reward_clocks (
  application_user_id CHAR(36) NOT NULL PRIMARY KEY,
  room_id CHAR(36) NULL,
  last_checkpoint_at DATETIME(3) NULL,
  CONSTRAINT fk_party_reward_clock_user FOREIGN KEY(application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS party_reward_days (
  application_user_id CHAR(36) NOT NULL,
  reward_day DATE NOT NULL,
  business_timezone VARCHAR(64) NOT NULL,
  eligible_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY(application_user_id,reward_day),
  CONSTRAINT fk_party_reward_day_user FOREIGN KEY(application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS party_reward_claims (
  id CHAR(36) NOT NULL PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  reward_day DATE NOT NULL,
  interval_index TINYINT UNSIGNED NOT NULL,
  request_id CHAR(36) NOT NULL,
  amount INT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL,
  balance_after BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_party_reward_interval(application_user_id,reward_day,interval_index),
  UNIQUE KEY uq_party_reward_request(application_user_id,request_id),
  UNIQUE KEY uq_party_reward_ledger(ledger_transaction_id),
  CONSTRAINT chk_party_reward_amount CHECK(amount IN (20,30,50,100)),
  CONSTRAINT chk_party_reward_interval CHECK(interval_index BETWEEN 1 AND 5),
  CONSTRAINT fk_party_reward_claim_user FOREIGN KEY(application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_party_reward_claim_ledger FOREIGN KEY(ledger_transaction_id) REFERENCES ledger_transactions(id)
) ENGINE=InnoDB;
INSERT IGNORE INTO system_settings(setting_key,setting_value,updated_by)
SELECT 'mobile.party_coin_rewards', '{"enabled":true,"timezone":"Asia/Kolkata","weights":{"20":1,"30":1,"50":1,"100":1}}', id
FROM platform_accounts WHERE role='MASTER' AND status='ACTIVE' ORDER BY created_at LIMIT 1;
