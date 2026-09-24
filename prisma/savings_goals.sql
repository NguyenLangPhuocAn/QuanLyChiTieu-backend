ALTER TABLE wallets
  MODIFY COLUMN wallet_type ENUM('CASH', 'BANK', 'E_WALLET', 'SAVINGS') NOT NULL DEFAULT 'CASH';

ALTER TABLE categories
  MODIFY COLUMN cash_flow_group ENUM('NORMAL', 'LOAN_DEBT', 'SAVING_TRANSFER') NOT NULL DEFAULT 'NORMAL';

UPDATE categories
SET cash_flow_group = 'SAVING_TRANSFER'
WHERE type = 'EXPENSE'
  AND (
    LOWER(COALESCE(icon, '')) LIKE '%expense_saving%'
    OR LOWER(COALESCE(name, '')) IN ('tiết kiệm', 'tiet kiem', 'saving', 'savings')
  );

CREATE TABLE IF NOT EXISTS savings_goals (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  wallet_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  target_amount DECIMAL(15,2) NOT NULL,
  target_date DATETIME NULL,
  note TEXT NULL,
  status ENUM('ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY savings_goals_wallet_id_key (wallet_id),
  KEY savings_goals_user_state_idx (user_id, deleted_at, status),
  CONSTRAINT savings_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT savings_goals_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_transfers (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  source_wallet_id INT NOT NULL,
  destination_wallet_id INT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  transfer_date DATETIME NOT NULL,
  note TEXT NULL,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY wallet_transfers_user_history_idx (user_id, deleted_at, transfer_date),
  KEY wallet_transfers_source_wallet_idx (source_wallet_id),
  KEY wallet_transfers_destination_wallet_idx (destination_wallet_id),
  CONSTRAINT wallet_transfers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT wallet_transfers_source_wallet_id_fkey FOREIGN KEY (source_wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
  CONSTRAINT wallet_transfers_destination_wallet_id_fkey FOREIGN KEY (destination_wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS savings_goal_entries (
  id INT NOT NULL AUTO_INCREMENT,
  goal_id INT NOT NULL,
  transfer_id INT NULL,
  type ENUM('CONTRIBUTION', 'WITHDRAWAL', 'ADJUSTMENT') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  entry_date DATETIME NOT NULL,
  note TEXT NULL,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY savings_goal_entries_transfer_id_key (transfer_id),
  KEY savings_goal_entries_history_idx (goal_id, deleted_at, entry_date),
  CONSTRAINT savings_goal_entries_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES savings_goals(id) ON DELETE CASCADE,
  CONSTRAINT savings_goal_entries_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES wallet_transfers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
