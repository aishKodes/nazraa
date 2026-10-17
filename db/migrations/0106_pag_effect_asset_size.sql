-- PAG is a separate, bounded native format. Keep every existing image/audio/
-- Lottie/video check unchanged; expand only .pag application/octet-stream.
SET @nazraa_has_asset_check = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='gift_assets'
    AND CONSTRAINT_NAME='chk_gift_assets_size'
);
-- Replace in ONE DDL statement: a validation failure must not leave the table
-- without its previous constraint (DDL cannot be rolled back like DML).
SET @nazraa_sql=CONCAT('ALTER TABLE gift_assets ',
  IF(@nazraa_has_asset_check>0,'DROP CONSTRAINT chk_gift_assets_size, ',''),
  'ADD CONSTRAINT chk_gift_assets_size CHECK (
    (mime_type=''application/octet-stream'' AND LOWER(RIGHT(original_name,4))=''.pag''
      AND byte_size BETWEEN 8 AND 12582912)
    OR (mime_type<>''application/octet-stream'' AND byte_size BETWEEN 1000 AND 3145728)
  )');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
