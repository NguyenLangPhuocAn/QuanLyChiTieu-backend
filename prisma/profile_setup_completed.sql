SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN profile_setup_completed TINYINT(1) NULL DEFAULT 0 AFTER must_change_password',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'profile_setup_completed'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE users
SET profile_setup_completed = 1
WHERE (profile_setup_completed IS NULL OR profile_setup_completed = 0)
  AND full_name IS NOT NULL
  AND TRIM(full_name) <> ''
  AND currency_default IS NOT NULL
  AND TRIM(currency_default) <> '';
