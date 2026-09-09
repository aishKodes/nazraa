-- Completed eligible Face Live hours are earned first and credited only when
-- the Host explicitly claims them from Rewards. Existing paid decisions are
-- preserved as claimed history so this migration can never duplicate payout.

CREATE TABLE IF NOT EXISTS live_reward_entitlements (
  id CHAR(36) PRIMARY KEY,
  live_hour_reward_decision_id CHAR(36) NOT NULL,
  live_session_accounting_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  agency_account_id CHAR(36) NULL,
  completed_hour INT UNSIGNED NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'DIAMONDS',
  source VARCHAR(64) NOT NULL DEFAULT 'HOST_HOURLY_DIAMONDS',
  claim_status ENUM('UNCLAIMED','CLAIMED') NOT NULL DEFAULT 'UNCLAIMED',
  earned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claimed_at DATETIME(3) NULL,
  ledger_transaction_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_reward_entitlement_decision FOREIGN KEY (live_hour_reward_decision_id) REFERENCES live_hour_reward_decisions(id),
  CONSTRAINT fk_live_reward_entitlement_session FOREIGN KEY (live_session_accounting_id) REFERENCES live_session_accounting(id),
  CONSTRAINT fk_live_reward_entitlement_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_reward_entitlement_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_live_reward_entitlement_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_live_reward_entitlement_decision (live_hour_reward_decision_id),
  UNIQUE KEY uq_live_reward_entitlement_hour (live_session_accounting_id, completed_hour),
  INDEX idx_live_reward_entitlement_claims (application_user_id, claim_status, earned_at),
  CHECK (completed_hour >= 1),
  CHECK (amount > 0),
  CHECK (currency = 'DIAMONDS'),
  CHECK (source = 'HOST_HOURLY_DIAMONDS'),
  CHECK ((claim_status = 'UNCLAIMED' AND claimed_at IS NULL AND ledger_transaction_id IS NULL)
      OR (claim_status = 'CLAIMED' AND claimed_at IS NOT NULL AND ledger_transaction_id IS NOT NULL))
) ENGINE=InnoDB;

INSERT IGNORE INTO live_reward_entitlements
  (id, live_hour_reward_decision_id, live_session_accounting_id,
   application_user_id, agency_account_id, completed_hour, amount, currency,
   source, claim_status, earned_at, claimed_at, ledger_transaction_id)
SELECT UUID(), decision.id, decision.live_session_accounting_id,
       decision.host_application_user_id, room.agency_account_id,
       decision.completed_hour, decision.reward_diamonds, 'DIAMONDS',
       'HOST_HOURLY_DIAMONDS',
       IF(decision.ledger_transaction_id IS NULL, 'UNCLAIMED', 'CLAIMED'),
       decision.decided_at,
       IF(decision.ledger_transaction_id IS NULL, NULL, decision.decided_at),
       decision.ledger_transaction_id
FROM live_hour_reward_decisions decision
INNER JOIN live_session_accounting accounting
  ON accounting.id = decision.live_session_accounting_id
INNER JOIN live_rooms room ON room.id = accounting.room_id
WHERE decision.eligible = TRUE AND decision.reward_diamonds > 0;

UPDATE policy_documents
SET body_json = JSON_SET(
  body_json,
  '$.sections[2].rules[0]',
  'Each eligible female Host earns one claimable 3,500-Diamond reward for every completed continuous 60-minute Face Live block. Diamonds enter the withdrawable balance only after the Host claims the reward. Male and other Hosts may stream normally but receive no Live-time reward. Party Audio earns no hourly reward.'
)
WHERE policy_key = 'host-live-access' AND active = TRUE;
