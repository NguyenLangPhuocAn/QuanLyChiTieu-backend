SET @has_name := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND column_name = 'name'
);
SET @sql := IF(@has_name = 0, 'ALTER TABLE budgets ADD COLUMN name VARCHAR(100) NULL AFTER user_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_category_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND column_name = 'category_id'
);
SET @sql := IF(@has_category_id = 0, 'ALTER TABLE budgets ADD COLUMN category_id INT NULL AFTER wallet_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_scope := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND column_name = 'scope'
);
SET @sql := IF(@has_scope = 0, 'ALTER TABLE budgets ADD COLUMN scope ENUM(''WALLET'', ''CATEGORY'') NOT NULL DEFAULT ''WALLET'' AFTER category_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_duplicate_key := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND column_name = 'duplicate_category_key'
);
SET @sql := IF(
  @has_duplicate_key = 0,
  'ALTER TABLE budgets ADD COLUMN duplicate_category_key INT GENERATED ALWAYS AS (IFNULL(category_id, 0)) STORED AFTER category_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_limit_amount := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND column_name = 'limit_amount'
);
SET @has_amount := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND column_name = 'amount'
);
SET @sql := IF(
  @has_limit_amount = 0 AND @has_amount > 0,
  'ALTER TABLE budgets CHANGE COLUMN amount limit_amount DECIMAL(15, 2) NOT NULL',
  IF(@has_limit_amount = 0, 'ALTER TABLE budgets ADD COLUMN limit_amount DECIMAL(15, 2) NOT NULL DEFAULT 0 AFTER scope', 'SELECT 1')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE budgets b
INNER JOIN wallets w ON w.id = b.wallet_id
SET b.name = CONCAT('Ngân sách ', w.name)
WHERE b.name IS NULL OR b.name = '';

ALTER TABLE budgets MODIFY COLUMN name VARCHAR(100) NOT NULL;
ALTER TABLE budgets MODIFY COLUMN period ENUM('WEEKLY', 'MONTHLY', 'YEARLY', 'WEEK', 'MONTH', 'YEAR') NOT NULL;
UPDATE budgets SET period = 'WEEK' WHERE period = 'WEEKLY';
UPDATE budgets SET period = 'MONTH' WHERE period = 'MONTHLY';
UPDATE budgets SET period = 'YEAR' WHERE period = 'YEARLY';
ALTER TABLE budgets MODIFY COLUMN period ENUM('WEEK', 'MONTH', 'YEAR') NOT NULL;

SET @has_category_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND index_name = 'budgets_category_id_idx'
);
SET @sql := IF(@has_category_idx = 0, 'CREATE INDEX budgets_category_id_idx ON budgets(category_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_duplicate_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND index_name = 'budgets_duplicate_lookup_idx'
);
SET @sql := IF(
  @has_duplicate_idx = 0,
  'CREATE INDEX budgets_duplicate_lookup_idx ON budgets(user_id, scope, wallet_id, category_id, period, start_date, end_date)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_duplicate_unique_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'budgets'
    AND index_name = 'budgets_duplicate_unique_idx'
);
SET @sql := IF(
  @has_duplicate_unique_idx = 0,
  'CREATE UNIQUE INDEX budgets_duplicate_unique_idx ON budgets(user_id, scope, wallet_id, duplicate_category_key, period, start_date, end_date)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
