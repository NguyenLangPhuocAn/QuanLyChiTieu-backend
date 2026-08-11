SET @add_users_deleted_at := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL AFTER is_active',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'deleted_at'
);
PREPARE stmt FROM @add_users_deleted_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
