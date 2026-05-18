SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE wallets ADD COLUMN wallet_type ENUM(''CASH'', ''BANK'', ''E_WALLET'') NOT NULL DEFAULT ''CASH'' AFTER name',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'wallet_type'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
