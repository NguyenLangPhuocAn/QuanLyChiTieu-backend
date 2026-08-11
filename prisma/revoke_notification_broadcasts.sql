SET @has_revoked_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notification_broadcasts'
    AND COLUMN_NAME = 'revoked_at'
);

SET @sql := IF(
  @has_revoked_at = 0,
  'ALTER TABLE notification_broadcasts ADD COLUMN revoked_at DATETIME NULL AFTER created_at',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
