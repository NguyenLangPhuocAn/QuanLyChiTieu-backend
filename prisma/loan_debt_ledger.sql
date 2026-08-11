CREATE TABLE IF NOT EXISTS loan_debts (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  person_name VARCHAR(100) NOT NULL,
  type ENUM('BORROWED', 'LENT') NOT NULL,
  principal_amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  due_date DATETIME NULL,
  note TEXT NULL,
  opening_wallet_id INT NOT NULL,
  opening_transaction_id INT NOT NULL,
  status ENUM('OPEN', 'PAID') NOT NULL DEFAULT 'OPEN',
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY loan_debts_opening_transaction_key (opening_transaction_id),
  KEY loan_debts_user_state_idx (user_id, deleted_at, status, due_date),
  KEY loan_debts_opening_wallet_idx (opening_wallet_id),
  CONSTRAINT loan_debts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_debt_payments (
  id INT NOT NULL AUTO_INCREMENT,
  loan_debt_id INT NOT NULL,
  wallet_id INT NOT NULL,
  transaction_id INT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATETIME NOT NULL,
  note TEXT NULL,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY loan_debt_payments_transaction_key (transaction_id),
  KEY loan_debt_payments_history_idx (loan_debt_id, deleted_at, payment_date),
  KEY loan_debt_payments_wallet_idx (wallet_id),
  CONSTRAINT loan_debt_payments_loan_debt_fkey
    FOREIGN KEY (loan_debt_id) REFERENCES loan_debts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
