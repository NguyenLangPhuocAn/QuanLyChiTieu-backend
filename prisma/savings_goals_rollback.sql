-- Chỉ dùng khi cần quay lại trước khi phát sinh dữ liệu mục tiêu tiết kiệm.
-- Script cố ý dừng nếu vẫn còn ví SAVINGS; hãy xuất/đối soát dữ liệu trước khi rollback.
CREATE TEMPORARY TABLE savings_rollback_guard (
  savings_wallet_count BIGINT NOT NULL,
  CONSTRAINT savings_rollback_guard_must_be_empty
    CHECK (savings_wallet_count = 0)
);

INSERT INTO savings_rollback_guard (savings_wallet_count)
SELECT COUNT(*)
FROM wallets
WHERE wallet_type = 'SAVINGS';

DROP TEMPORARY TABLE savings_rollback_guard;

DROP TABLE IF EXISTS savings_goal_entries;
DROP TABLE IF EXISTS wallet_transfers;
DROP TABLE IF EXISTS savings_goals;

ALTER TABLE wallets
  MODIFY COLUMN wallet_type ENUM('CASH', 'BANK', 'E_WALLET') NOT NULL DEFAULT 'CASH';

UPDATE categories
SET cash_flow_group = 'NORMAL'
WHERE cash_flow_group = 'SAVING_TRANSFER';

ALTER TABLE categories
  MODIFY COLUMN cash_flow_group ENUM('NORMAL', 'LOAN_DEBT') NOT NULL DEFAULT 'NORMAL';
