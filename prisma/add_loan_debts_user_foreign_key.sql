-- Run after loan_debt_ledger.sql on existing databases.
SET @has_loan_debts_user_fk := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'loan_debts'
    AND COLUMN_NAME = 'user_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);

SET @sql := IF(
  @has_loan_debts_user_fk = 0,
  'ALTER TABLE loan_debts ADD CONSTRAINT loan_debts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
