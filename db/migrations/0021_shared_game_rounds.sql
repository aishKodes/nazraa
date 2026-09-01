-- Shared, server-timed rounds for Luck77, Greedy Lion, Greedy King and
-- Bounty Football. Jungle Hunt remains an individual authoritative spin.
CREATE TABLE IF NOT EXISTS game_shared_rounds (
  id CHAR(36) PRIMARY KEY,
  game_name VARCHAR(64) NOT NULL,
  round_number BIGINT UNSIGNED NOT NULL,
  betting_starts_at DATETIME(3) NOT NULL,
  betting_ends_at DATETIME(3) NOT NULL,
  drawing_ends_at DATETIME(3) NOT NULL,
  result_ends_at DATETIME(3) NOT NULL,
  outcome_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_shared_game_round (game_name, round_number),
  INDEX idx_shared_game_timeline (game_name, betting_starts_at, result_ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS game_shared_bet_requests (
  id CHAR(36) PRIMARY KEY,
  request_id CHAR(36) NOT NULL,
  round_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  bets_json JSON NOT NULL,
  wager_total BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_shared_request_round FOREIGN KEY (round_id) REFERENCES game_shared_rounds(id),
  CONSTRAINT fk_shared_request_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_shared_request_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_shared_bet_request (application_user_id, request_id),
  INDEX idx_shared_request_round_user (round_id, application_user_id, created_at),
  CHECK (wager_total > 0 AND wager_total <= 50000000)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS game_shared_bets (
  id CHAR(36) PRIMARY KEY,
  request_id CHAR(36) NOT NULL,
  round_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_shared_bet_request FOREIGN KEY (request_id) REFERENCES game_shared_bet_requests(id),
  CONSTRAINT fk_shared_bet_round FOREIGN KEY (round_id) REFERENCES game_shared_rounds(id),
  CONSTRAINT fk_shared_bet_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_shared_bet_totals (round_id, target_id),
  INDEX idx_shared_bet_user_round (application_user_id, round_id),
  CHECK (amount > 0 AND amount <= 50000000)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS game_shared_settlements (
  id CHAR(36) PRIMARY KEY,
  round_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  wager_total BIGINT UNSIGNED NOT NULL,
  gross_payout BIGINT UNSIGNED NOT NULL,
  deduction_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
  payout_total BIGINT UNSIGNED NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  result_record_id CHAR(36) NOT NULL,
  settled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_shared_settlement_round FOREIGN KEY (round_id) REFERENCES game_shared_rounds(id),
  CONSTRAINT fk_shared_settlement_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_shared_settlement_result FOREIGN KEY (result_record_id) REFERENCES game_round_results(id),
  UNIQUE KEY uq_shared_settlement (round_id, application_user_id),
  INDEX idx_shared_settlement_user (application_user_id, settled_at)
) ENGINE=InnoDB;
