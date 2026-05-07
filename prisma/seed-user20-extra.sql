-- Seed bổ sung cho user id 20 để test biểu đồ, ngân sách và lịch sử giao dịch.
SET @wallet_id := (SELECT id FROM wallets WHERE user_id = 20 ORDER BY id LIMIT 1);
SET @expense_category_id := (SELECT id FROM categories WHERE type = 'EXPENSE' ORDER BY is_system DESC, id LIMIT 1);
SET @income_category_id := (SELECT id FROM categories WHERE type = 'INCOME' ORDER BY is_system DESC, id LIMIT 1);

INSERT INTO transactions (wallet_id, category_id, amount, note, transaction_date, created_at)
SELECT @wallet_id, @expense_category_id, -135000.00, 'Cà phê làm việc', '2026-05-01 09:15:00', NOW()
WHERE @wallet_id IS NOT NULL AND @expense_category_id IS NOT NULL;

INSERT INTO transactions (wallet_id, category_id, amount, note, transaction_date, created_at)
SELECT @wallet_id, @expense_category_id, -420000.00, 'Mua thực phẩm cuối tuần', '2026-05-01 18:30:00', NOW()
WHERE @wallet_id IS NOT NULL AND @expense_category_id IS NOT NULL;

INSERT INTO transactions (wallet_id, category_id, amount, note, transaction_date, created_at)
SELECT @wallet_id, @expense_category_id, -95000.00, 'Vé xe công nghệ', '2026-05-02 08:10:00', NOW()
WHERE @wallet_id IS NOT NULL AND @expense_category_id IS NOT NULL;

INSERT INTO transactions (wallet_id, category_id, amount, note, transaction_date, created_at)
SELECT @wallet_id, @income_category_id, 1200000.00, 'Freelance cuối tuần', '2026-05-02 20:00:00', NOW()
WHERE @wallet_id IS NOT NULL AND @income_category_id IS NOT NULL;

UPDATE wallets
SET balance = balance + 550000.00
WHERE id = @wallet_id;
