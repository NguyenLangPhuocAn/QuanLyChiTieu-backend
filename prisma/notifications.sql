CREATE TABLE IF NOT EXISTS notification_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  budget_alerts_enabled BOOLEAN DEFAULT TRUE,
  budget_expiring_enabled BOOLEAN DEFAULT TRUE,
  system_notifications_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY notification_settings_user_id_key (user_id),
  CONSTRAINT notification_settings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_broadcasts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NULL,
  title VARCHAR(120) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  KEY notification_broadcasts_admin_id_idx (admin_id),
  KEY notification_broadcasts_created_at_idx (created_at),
  CONSTRAINT notification_broadcasts_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  broadcast_id INT NULL,
  type ENUM('BUDGET_WARNING', 'BUDGET_EXCEEDED', 'BUDGET_EXPIRING', 'SYSTEM') NOT NULL,
  severity ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
  title VARCHAR(120) NOT NULL,
  message TEXT NOT NULL,
  source_type VARCHAR(40) NULL,
  source_id INT NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  read_at DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY notifications_user_dedupe_key (user_id, dedupe_key),
  KEY notifications_user_state_idx (user_id, deleted_at, read_at, created_at),
  KEY notifications_broadcast_id_idx (broadcast_id),
  CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT notifications_broadcast_id_fkey
    FOREIGN KEY (broadcast_id) REFERENCES notification_broadcasts(id) ON DELETE SET NULL
);
