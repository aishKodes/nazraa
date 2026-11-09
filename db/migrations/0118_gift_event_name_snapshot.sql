-- Immutable display names for new gift receipts. Existing Coin/Diamond values
-- and ledger records already hold their original settled amounts.
SET @missing=(SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='live_room_gift_events'
  AND COLUMN_NAME='gift_name_snapshot')=0;
SET @ddl=IF(@missing,'ALTER TABLE live_room_gift_events ADD COLUMN gift_name_snapshot VARCHAR(100) NULL','SELECT 1');
PREPARE gift_snapshot_ddl FROM @ddl;
EXECUTE gift_snapshot_ddl;
DEALLOCATE PREPARE gift_snapshot_ddl;
