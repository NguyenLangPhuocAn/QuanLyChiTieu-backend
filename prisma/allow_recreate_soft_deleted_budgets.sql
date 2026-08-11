SET @schema_name := DATABASE();

SET @has_is_active := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'budgets'
    AND column_name = 'is_active'
);

SET @sql := IF(
  @has_is_active = 0,
  'ALTER TABLE budgets ADD COLUMN is_active TINYINT(1) NULL DEFAULT 1 AFTER end_date',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_deleted_at := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'budgets'
    AND column_name = 'deleted_at'
);

SET @sql := IF(
  @has_deleted_at = 0,
  'ALTER TABLE budgets ADD COLUMN deleted_at DATETIME NULL AFTER is_active',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE budgets
SET is_active = IF(deleted_at IS NULL, 1, 0)
WHERE is_active IS NULL;

SET @has_active_duplicate_key := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'budgets'
    AND column_name = 'active_duplicate_category_key'
);

SET @sql := IF(
  @has_active_duplicate_key = 0,
  'ALTER TABLE budgets ADD COLUMN active_duplicate_category_key INT GENERATED ALWAYS AS (IF(COALESCE(is_active, 1) = 1, IFNULL(category_id, 0), NULL)) STORED AFTER duplicate_category_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_duplicate_unique_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'budgets'
    AND index_name = 'budgets_duplicate_unique_idx'
);

SET @sql := IF(
  @has_duplicate_unique_idx > 0,
  'DROP INDEX budgets_duplicate_unique_idx ON budgets',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE UNIQUE INDEX budgets_duplicate_unique_idx
  ON budgets (
    user_id,
    scope,
    wallet_id,
    active_duplicate_category_key,
    period,
    start_date,
    end_date
  );
