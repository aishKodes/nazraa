-- Valid, decoded WebP artwork can compress below the old 1 KB heuristic.
-- Preserve the 2 MB ceiling; signature, decoding and pixel limits stay in the upload pipeline.
SET @banner_check_name = (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'banner_assets' AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1);
SET @banner_drop_sql = IF(@banner_check_name IS NULL, 'SELECT 1',
  CONCAT('ALTER TABLE banner_assets DROP ', IF(LOCATE('MariaDB', VERSION()) > 0, 'CONSTRAINT ', 'CHECK '),
    '`', REPLACE(@banner_check_name, '`', '``'), '`'));
PREPARE banner_drop FROM @banner_drop_sql;
EXECUTE banner_drop;
DEALLOCATE PREPARE banner_drop;
ALTER TABLE banner_assets ADD CONSTRAINT ck_banner_valid_optimized_size CHECK (byte_size BETWEEN 1 AND 2097152);
