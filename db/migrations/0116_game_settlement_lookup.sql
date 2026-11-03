-- Additive covering lookup. Nullable legacy discriminators remain supported.
-- No changes to accepted wagers, settlement amounts, wallets or round snapshots.
SET @missing=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='game_shared_bets' AND INDEX_NAME='idx_shared_bet_game_pending')=0;
SET @ddl=IF(@missing,'ALTER TABLE game_shared_bets ADD INDEX idx_shared_bet_game_pending (game_name,round_id,application_user_id), ALGORITHM=INPLACE, LOCK=NONE','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
