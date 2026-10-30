-- Extend the existing mobile.games configuration and shared-round ledger.
-- No wallet, historical result, payout, or outcome is rewritten.
CREATE TABLE IF NOT EXISTS game_config_versions (
  game_name VARCHAR(64) NOT NULL,
  version BIGINT UNSIGNED NOT NULL,
  previous_config JSON NOT NULL,
  config_json JSON NOT NULL,
  actor_account_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  effective_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (game_name, version),
  INDEX idx_game_config_effective (effective_at),
  CONSTRAINT fk_game_config_actor FOREIGN KEY (actor_account_id) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;

-- Resumable on both MariaDB and MySQL after an interrupted additive DDL.
SET @game_version_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='game_shared_rounds' AND COLUMN_NAME='config_version')=0,
  'ALTER TABLE game_shared_rounds ADD COLUMN config_version BIGINT UNSIGNED NOT NULL DEFAULT 0','SELECT 1');
PREPARE game_version_stmt FROM @game_version_ddl;
EXECUTE game_version_stmt;
DEALLOCATE PREPARE game_version_stmt;
SET @game_snapshot_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='game_shared_rounds' AND COLUMN_NAME='config_json')=0,
  'ALTER TABLE game_shared_rounds ADD COLUMN config_json JSON NULL','SELECT 1');
PREPARE game_snapshot_stmt FROM @game_snapshot_ddl;
EXECUTE game_snapshot_stmt;
DEALLOCATE PREPARE game_snapshot_stmt;

-- Freeze only unsettled/current rounds at deployment. Settled history stays
-- untouched. Version 0 explicitly means the pre-versioning baseline.
UPDATE game_shared_rounds r JOIN system_settings s ON s.setting_key='mobile.games'
SET r.config_json=JSON_SET(
  COALESCE(JSON_EXTRACT(s.setting_value,CONCAT('$.games.',r.game_name)),JSON_OBJECT()),
  '$.settlementDeductionRate',COALESCE(JSON_EXTRACT(s.setting_value,'$.winnings_deduction_rate'),JSON_EXTRACT(s.setting_value,'$.winningsDeductionRate'),0.01))
WHERE r.config_json IS NULL AND (r.result_ends_at>UTC_TIMESTAMP(3) OR EXISTS (
  SELECT 1 FROM game_shared_bets b LEFT JOIN game_shared_settlements p
    ON p.round_id=b.round_id AND p.application_user_id=b.application_user_id
  WHERE b.round_id=r.id AND p.id IS NULL));
