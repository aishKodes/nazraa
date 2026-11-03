-- Additive, repeatable playback acknowledgement; old clients retain semantics.
SET @missing=(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='party_room_music' AND COLUMN_NAME='playback_state')=0;
SET @ddl=IF(@missing,'ALTER TABLE party_room_music ADD COLUMN playback_state VARCHAR(16) NOT NULL DEFAULT ''IDLE''','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
