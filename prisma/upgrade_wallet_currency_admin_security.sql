-- Safe upgrade for wallet currency, media varchar sync, and super admin security.
-- Run this script on MySQL before deploying the updated backend.

SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NULL DEFAULT 1 AFTER provider_id',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'is_active'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE users MODIFY avatar VARCHAR(255) NULL;
ALTER TABLE transactions MODIFY receipt_image VARCHAR(255) NULL;
ALTER TABLE categories MODIFY icon VARCHAR(255) NULL;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE wallets ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT ''VND'' AFTER name',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'currency'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE wallets w
LEFT JOIN users u ON u.id = w.user_id
SET w.currency = COALESCE(NULLIF(w.currency, ''), NULLIF(u.currency_default, ''), 'VND')
WHERE w.currency IS NULL OR w.currency = '';

INSERT INTO users (email, password, role, currency_default, provider, is_active)
VALUES (
  'admin@gmail.com',
  '$2b$10$cN5HyIVGErfIpJY1yensQuyeaj6OIK1ClJEDhM5.V5PIarCGDEFXW',
  'ADMIN',
  'VND',
  'local',
  1
)
ON DUPLICATE KEY UPDATE
  role = 'ADMIN',
  currency_default = COALESCE(currency_default, 'VND'),
  is_active = 1;

INSERT INTO users (email, password, role, currency_default, provider, is_active)
VALUES (
  'premium.currency.test@gmail.com',
  '$2b$10$DJDC9tlxnPM6V1zJvKfRzepe0q4cTF0.zL2sj0gacsGX49hmtTfhO',
  'PREMIUM',
  'EUR',
  'local',
  1
)
ON DUPLICATE KEY UPDATE
  role = 'PREMIUM',
  currency_default = 'EUR',
  is_active = 1;

INSERT INTO wallets (user_id, name, currency, balance)
SELECT u.id, 'Premium EUR Wallet', 'EUR', 500
FROM users u
WHERE u.email = 'premium.currency.test@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM wallets w
    WHERE w.user_id = u.id AND w.currency = 'EUR'
  );

INSERT INTO wallets (user_id, name, currency, balance)
SELECT u.id, 'Vi USD testregister', 'USD', 100
FROM users u
WHERE u.email = 'testregister@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM wallets w
    WHERE w.user_id = u.id AND w.currency = 'USD'
  );
