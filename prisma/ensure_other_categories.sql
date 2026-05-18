-- Ensure the system "Khác" category exists on both income and expense sides.
-- Basic users see system categories only; Premium users see system + personal categories.

INSERT INTO categories (name, type, icon, is_system, user_id)
SELECT 'Khác', 'INCOME', 'categories/icons/expense_other.png', 1, NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM categories
  WHERE name = 'Khác'
    AND type = 'INCOME'
    AND is_system = 1
);

UPDATE categories
SET icon = 'categories/icons/expense_other.png'
WHERE name = 'Khác'
  AND type = 'INCOME'
  AND is_system = 1;

INSERT INTO categories (name, type, icon, is_system, user_id)
SELECT 'Khác', 'EXPENSE', 'categories/icons/expense_other.png', 1, NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM categories
  WHERE name = 'Khác'
    AND type = 'EXPENSE'
    AND is_system = 1
);
