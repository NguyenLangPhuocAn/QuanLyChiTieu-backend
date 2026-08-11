SET @add_budget_is_active := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE budgets ADD COLUMN is_active TINYINT(1) NULL DEFAULT 1 AFTER end_date',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'budgets'
    AND COLUMN_NAME = 'is_active'
);
PREPARE stmt FROM @add_budget_is_active;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_budget_deleted_at := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE budgets ADD COLUMN deleted_at DATETIME NULL AFTER is_active',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'budgets'
    AND COLUMN_NAME = 'deleted_at'
);
PREPARE stmt FROM @add_budget_deleted_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE budgets SET is_active = 1 WHERE is_active IS NULL;

ALTER TABLE budgets
  MODIFY period ENUM('WEEK', 'MONTH', 'YEAR', 'CUSTOM') NOT NULL;
