-- Additive and restart-safe. Never activates rates or rewrites history.
SET @schema_name=DATABASE();
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='live_room_gift_events' AND COLUMN_NAME='gift_batch_id')=0,
 'ALTER TABLE live_room_gift_events ADD COLUMN gift_batch_id VARCHAR(160) NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='live_room_gift_events' AND COLUMN_NAME='platform_fee')=0,
 'ALTER TABLE live_room_gift_events ADD COLUMN platform_fee BIGINT UNSIGNED NOT NULL DEFAULT 0','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='live_room_gift_events' AND COLUMN_NAME='platform_fee_bps')=0,
 'ALTER TABLE live_room_gift_events ADD COLUMN platform_fee_bps SMALLINT UNSIGNED NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='live_room_gift_events' AND COLUMN_NAME='fee_policy_version')=0,
 'ALTER TABLE live_room_gift_events ADD COLUMN fee_policy_version VARCHAR(32) NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='live_room_gift_events' AND COLUMN_NAME='gift_context')=0,
 'ALTER TABLE live_room_gift_events ADD COLUMN gift_context VARCHAR(16) NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='pk_host_streaks' AND COLUMN_NAME='random_current_wins')=0,
 'ALTER TABLE pk_host_streaks ADD COLUMN random_current_wins TINYINT UNSIGNED NOT NULL DEFAULT 0','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='pk_host_streaks' AND COLUMN_NAME='random_cycle_id')=0,
 'ALTER TABLE pk_host_streaks ADD COLUMN random_cycle_id CHAR(36) NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='pk_host_streaks' AND COLUMN_NAME='random_qualifying_wins_total')=0,
 'ALTER TABLE pk_host_streaks ADD COLUMN random_qualifying_wins_total INT UNSIGNED NOT NULL DEFAULT 0','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='pk_host_streak_events' AND COLUMN_NAME='reward_policy_version')=0,
 'ALTER TABLE pk_host_streak_events ADD COLUMN reward_policy_version TINYINT UNSIGNED NOT NULL DEFAULT 1','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='live_room_gift_events' AND INDEX_NAME='idx_gift_batch')=0,
 'ALTER TABLE live_room_gift_events ADD INDEX idx_gift_batch (gift_batch_id)','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Match foreign-key column collations to the existing authoritative tables.
SET @application_user_id_type=(SELECT CONCAT('CHAR(36) CHARACTER SET ',CHARACTER_SET_NAME,' COLLATE ',COLLATION_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='application_users' AND COLUMN_NAME='id');
SET @completed_session_id_type=(SELECT CONCAT('CHAR(36) CHARACTER SET ',CHARACTER_SET_NAME,' COLLATE ',COLLATION_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='live_pk_sessions' AND COLUMN_NAME='id');
SET @ledger_transaction_id_type=(SELECT CONCAT('CHAR(36) CHARACTER SET ',CHARACTER_SET_NAME,' COLLATE ',COLLATION_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ledger_transactions' AND COLUMN_NAME='id');
SET @ddl=CONCAT('CREATE TABLE IF NOT EXISTS pk_reward_claims (
  id CHAR(36) PRIMARY KEY,
  application_user_id ',@application_user_id_type,' NOT NULL,
  cycle_id CHAR(36) NOT NULL,
  completed_session_id ',@completed_session_id_type,' NOT NULL,
  reward_coins BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT ''CLAIMABLE'',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claimed_at DATETIME(3) NULL,
  ledger_transaction_id ',@ledger_transaction_id_type,' NULL,
  UNIQUE KEY uq_pk_reward_cycle (application_user_id,cycle_id),
  UNIQUE KEY uq_pk_reward_ledger (ledger_transaction_id),
  CONSTRAINT fk_pk_reward_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_pk_reward_session FOREIGN KEY (completed_session_id) REFERENCES live_pk_sessions(id),
  CONSTRAINT fk_pk_reward_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  CHECK (reward_coins=5000),
  CHECK (status IN (''CLAIMABLE'',''CLAIMED''))
);');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
