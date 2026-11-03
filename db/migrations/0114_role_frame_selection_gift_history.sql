-- Additive presentation preferences only. Wallets, roles and financial history stay intact.
SET @schema_name=DATABASE();
SET @missing=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='application_users' AND COLUMN_NAME='equipped_role_frame')=0;
SET @ddl=IF(@missing,'ALTER TABLE application_users ADD COLUMN equipped_role_frame VARCHAR(40) NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @missing=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='application_users' AND COLUMN_NAME='role_frame_grants')=0;
SET @ddl=IF(@missing,'ALTER TABLE application_users ADD COLUMN role_frame_grants JSON NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
-- History uses existing idx_room_gift_sender_created and idx_room_gift_receiver_created.
