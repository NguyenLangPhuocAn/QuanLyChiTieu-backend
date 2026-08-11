CREATE TABLE IF NOT EXISTS budgets (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  wallet_id INT NOT NULL,
  category_id INT NULL,
  duplicate_category_key INT GENERATED ALWAYS AS (IFNULL(category_id, 0)) STORED,
  is_active TINYINT(1) NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  active_duplicate_category_key INT GENERATED ALWAYS AS (
    IF(COALESCE(is_active, 1) = 1, IFNULL(category_id, 0), NULL)
  ) STORED,
  scope ENUM('WALLET', 'CATEGORY') NOT NULL DEFAULT 'WALLET',
  limit_amount DECIMAL(15, 2) NOT NULL,
  period ENUM('WEEK', 'MONTH', 'YEAR') NOT NULL,
  start_date DATETIME NOT NULL,
  end_date DATETIME NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX budgets_user_id_idx (user_id),
  INDEX budgets_wallet_id_idx (wallet_id),
  INDEX budgets_category_id_idx (category_id),
  INDEX budgets_wallet_period_idx (wallet_id, start_date, end_date),
  INDEX budgets_duplicate_lookup_idx (user_id, scope, wallet_id, category_id, period, start_date, end_date),
  UNIQUE INDEX budgets_duplicate_unique_idx (user_id, scope, wallet_id, active_duplicate_category_key, period, start_date, end_date),
  CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT budgets_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
);

SET @has_budget_limit := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'wallets'
    AND column_name = 'budget_limit'
);

SET @migrate_budget_sql := IF(
  @has_budget_limit > 0,
  'INSERT INTO budgets (user_id, name, wallet_id, category_id, scope, limit_amount, period, start_date, end_date, created_at, updated_at)
   SELECT
     w.user_id,
     CONCAT(''Ngân sách '', w.name),
     w.id,
     NULL,
     ''WALLET'',
     w.budget_limit,
     ''MONTH'',
     DATE_FORMAT(CURRENT_DATE(), ''%Y-%m-01 00:00:00''),
     DATE_SUB(DATE_ADD(DATE_FORMAT(CURRENT_DATE(), ''%Y-%m-01 00:00:00''), INTERVAL 1 MONTH), INTERVAL 1 SECOND),
     COALESCE(w.created_at, NOW()),
     NOW()
   FROM wallets w
   WHERE w.user_id IS NOT NULL
     AND w.budget_limit IS NOT NULL
     AND w.budget_limit > 0
     AND NOT EXISTS (
       SELECT 1
       FROM budgets b
       WHERE b.wallet_id = w.id
         AND b.start_date = DATE_FORMAT(CURRENT_DATE(), ''%Y-%m-01 00:00:00'')
         AND b.end_date = DATE_SUB(DATE_ADD(DATE_FORMAT(CURRENT_DATE(), ''%Y-%m-01 00:00:00''), INTERVAL 1 MONTH), INTERVAL 1 SECOND)
     )',
  'SELECT 1'
);
PREPARE migrate_budget_stmt FROM @migrate_budget_sql;
EXECUTE migrate_budget_stmt;
DEALLOCATE PREPARE migrate_budget_stmt;

SET @drop_budget_limit_sql := IF(@has_budget_limit > 0, 'ALTER TABLE wallets DROP COLUMN budget_limit', 'SELECT 1');
PREPARE drop_budget_limit_stmt FROM @drop_budget_limit_sql;
EXECUTE drop_budget_limit_stmt;
DEALLOCATE PREPARE drop_budget_limit_stmt;
