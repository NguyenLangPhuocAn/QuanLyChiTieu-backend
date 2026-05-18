-- JWT hardening migration: refresh-token rotation and token_version removal.

SET @db_name := DATABASE();

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  jti VARCHAR(64) NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY jti (jti),
  KEY refresh_tokens_user_id_idx (user_id)
);

SET @has_token_hash := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'refresh_tokens'
    AND COLUMN_NAME = 'token_hash'
);

SET @has_token := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'refresh_tokens'
    AND COLUMN_NAME = 'token'
);

SET @sql := IF(
  @has_token_hash > 0 AND @has_token = 0,
  'ALTER TABLE refresh_tokens CHANGE token_hash token VARCHAR(255) NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_token_hash > 0 AND @has_token > 0,
  'UPDATE refresh_tokens SET token = token_hash WHERE token_hash IS NOT NULL AND token_hash <> ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_token_hash > 0 AND @has_token > 0,
  'ALTER TABLE refresh_tokens DROP COLUMN token_hash',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE users DROP COLUMN token_version',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'token_version'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE refresh_tokens DROP COLUMN replaced_by_jti',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'refresh_tokens'
    AND COLUMN_NAME = 'replaced_by_jti'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE admin_logs
SET action = REPLACE(action, 'Nguoi dung dang nhap he thong', 'Người dùng đăng nhập hệ thống')
WHERE action LIKE '%Nguoi dung dang nhap he thong%';

UPDATE admin_logs
SET action = REPLACE(action, 'Nguoi dung dang xuat he thong', 'Người dùng đăng xuất hệ thống')
WHERE action LIKE '%Nguoi dung dang xuat he thong%';
