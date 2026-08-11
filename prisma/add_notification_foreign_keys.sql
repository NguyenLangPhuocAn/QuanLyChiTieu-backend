-- Run after notifications.sql on existing databases. Each constraint is added
-- only when its table/column does not already have a foreign-key constraint.

SET @has_notification_settings_user_fk := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notification_settings'
    AND COLUMN_NAME = 'user_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @sql := IF(
  @has_notification_settings_user_fk = 0,
  'ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_notification_broadcasts_admin_fk := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notification_broadcasts'
    AND COLUMN_NAME = 'admin_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @sql := IF(
  @has_notification_broadcasts_admin_fk = 0,
  'ALTER TABLE notification_broadcasts ADD CONSTRAINT notification_broadcasts_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_notifications_user_fk := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'user_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @sql := IF(
  @has_notifications_user_fk = 0,
  'ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_notifications_broadcast_fk := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'broadcast_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @sql := IF(
  @has_notifications_broadcast_fk = 0,
  'ALTER TABLE notifications ADD CONSTRAINT notifications_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES notification_broadcasts(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
