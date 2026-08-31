-- Server-authoritative, idempotent game rounds. Game coins remain in the
-- existing COIN ledger and never enter the withdrawable DIAMOND ledger.
CREATE TABLE IF NOT EXISTS game_round_results (
  id CHAR(36) PRIMARY KEY,
  client_round_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  game_name VARCHAR(64) NOT NULL,
  bets_json JSON NOT NULL,
  outcome_json JSON NOT NULL,
  wager_total BIGINT UNSIGNED NOT NULL,
  payout_total BIGINT UNSIGNED NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_game_round_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  UNIQUE KEY uq_game_round_client (application_user_id, client_round_id),
  INDEX idx_game_round_history (application_user_id, game_name, created_at),
  CHECK (wager_total <= 50000000),
  CHECK (payout_total <= 1250000000)
) ENGINE=InnoDB;
