SET @period_column = (
  SELECT COLUMN_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'budgets'
    AND COLUMN_NAME = 'period'
  LIMIT 1
);

SET @sql = IF(
  @period_column IS NOT NULL AND @period_column NOT LIKE '%''DAY''%',
  'ALTER TABLE budgets MODIFY COLUMN period ENUM(''DAY'', ''WEEK'', ''MONTH'', ''QUARTER'', ''YEAR'', ''CUSTOM'') NOT NULL',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
