-- Adds a durable category-level cash-flow grouping.
-- INCOME/EXPENSE remains the money direction. cash_flow_group controls whether a category is normal cash flow or loan/debt.

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categories'
    AND COLUMN_NAME = 'cash_flow_group'
);

SET @ddl := IF(
  @column_exists = 0,
  'ALTER TABLE categories ADD COLUMN cash_flow_group ENUM(''NORMAL'', ''LOAN_DEBT'') NOT NULL DEFAULT ''NORMAL'' AFTER type',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE categories
SET cash_flow_group = 'LOAN_DEBT'
WHERE (
    LOWER(COALESCE(icon, '')) LIKE '%loan%'
    OR LOWER(COALESCE(icon, '')) LIKE '%debt%'
    OR LOWER(COALESCE(name, '')) LIKE '%loan%'
    OR LOWER(COALESCE(name, '')) LIKE '%debt%'
    OR LOWER(COALESCE(name, '')) LIKE '%vay%'
    OR LOWER(COALESCE(name, '')) LIKE '%tra no%'
    OR LOWER(COALESCE(name, '')) LIKE '%thu no%'
  )
  AND cash_flow_group <> 'LOAN_DEBT';
