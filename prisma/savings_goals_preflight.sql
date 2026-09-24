-- Chạy read-only trước savings_goals.sql để biết chính xác dữ liệu cũ bị tác động.
SELECT wallet_type, COUNT(*) AS wallet_count
FROM wallets
GROUP BY wallet_type
ORDER BY wallet_type;

SELECT id, name, type, cash_flow_group, icon
FROM categories
WHERE type = 'EXPENSE'
  AND (
    LOWER(COALESCE(icon, '')) LIKE '%expense_saving%'
    OR LOWER(COALESCE(name, '')) IN ('tiết kiệm', 'tiet kiem', 'saving', 'savings')
  );

SELECT
  COUNT(t.id) AS legacy_saving_transaction_count,
  COALESCE(SUM(ABS(t.amount)), 0) AS legacy_saving_transaction_amount
FROM transactions t
INNER JOIN categories c ON c.id = t.category_id
WHERE c.type = 'EXPENSE'
  AND (
    LOWER(COALESCE(c.icon, '')) LIKE '%expense_saving%'
    OR LOWER(COALESCE(c.name, '')) IN ('tiết kiệm', 'tiet kiem', 'saving', 'savings')
  );

