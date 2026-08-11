-- Seed thong bao he thong tu phia admin de demo man hinh Notifications.
-- Chay lai file nay se khong tao trung notification cho tung user nho dedupe_key.

SET @admin_id := (
  SELECT id
  FROM users
  WHERE role = 'ADMIN'
    AND COALESCE(is_active, 1) = 1
  ORDER BY id ASC
  LIMIT 1
);

INSERT INTO notification_broadcasts (admin_id, title, message, severity, created_at)
SELECT
  @admin_id,
  'Chào mừng bạn đến với Tiêu gì',
  'Hệ thống đã sẵn sàng ghi nhận thu chi, theo dõi ví và cảnh báo ngân sách cho bạn.',
  'INFO',
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM notification_broadcasts
  WHERE title = 'Chào mừng bạn đến với Tiêu gì'
    AND message = 'Hệ thống đã sẵn sàng ghi nhận thu chi, theo dõi ví và cảnh báo ngân sách cho bạn.'
);

SET @broadcast_welcome_id := (
  SELECT id
  FROM notification_broadcasts
  WHERE title = 'Chào mừng bạn đến với Tiêu gì'
    AND message = 'Hệ thống đã sẵn sàng ghi nhận thu chi, theo dõi ví và cảnh báo ngân sách cho bạn.'
  ORDER BY id ASC
  LIMIT 1
);

INSERT INTO notifications (
  user_id,
  broadcast_id,
  type,
  severity,
  title,
  message,
  source_type,
  source_id,
  dedupe_key,
  created_at
)
SELECT
  u.id,
  @broadcast_welcome_id,
  'SYSTEM',
  'INFO',
  'Chào mừng bạn đến với Tiêu gì',
  'Hệ thống đã sẵn sàng ghi nhận thu chi, theo dõi ví và cảnh báo ngân sách cho bạn.',
  'broadcast',
  @broadcast_welcome_id,
  'seed-system:welcome:v1',
  NOW()
FROM users u
LEFT JOIN notification_settings ns ON ns.user_id = u.id
WHERE COALESCE(u.is_active, 1) = 1
  AND COALESCE(ns.system_notifications_enabled, 1) = 1
ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key);

INSERT INTO notification_broadcasts (admin_id, title, message, severity, created_at)
SELECT
  @admin_id,
  'Cân nhắc cập nhật ngân sách tháng này',
  'Bạn có thể đặt ngân sách theo ví hoặc theo danh mục để hệ thống cảnh báo khi chi tiêu gần vượt hạn mức.',
  'WARNING',
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM notification_broadcasts
  WHERE title = 'Cân nhắc cập nhật ngân sách tháng này'
    AND message = 'Bạn có thể đặt ngân sách theo ví hoặc theo danh mục để hệ thống cảnh báo khi chi tiêu gần vượt hạn mức.'
);

SET @broadcast_budget_id := (
  SELECT id
  FROM notification_broadcasts
  WHERE title = 'Cân nhắc cập nhật ngân sách tháng này'
    AND message = 'Bạn có thể đặt ngân sách theo ví hoặc theo danh mục để hệ thống cảnh báo khi chi tiêu gần vượt hạn mức.'
  ORDER BY id ASC
  LIMIT 1
);

INSERT INTO notifications (
  user_id,
  broadcast_id,
  type,
  severity,
  title,
  message,
  source_type,
  source_id,
  dedupe_key,
  created_at
)
SELECT
  u.id,
  @broadcast_budget_id,
  'SYSTEM',
  'WARNING',
  'Cân nhắc cập nhật ngân sách tháng này',
  'Bạn có thể đặt ngân sách theo ví hoặc theo danh mục để hệ thống cảnh báo khi chi tiêu gần vượt hạn mức.',
  'broadcast',
  @broadcast_budget_id,
  'seed-system:budget-reminder:v1',
  NOW()
FROM users u
LEFT JOIN notification_settings ns ON ns.user_id = u.id
WHERE COALESCE(u.is_active, 1) = 1
  AND COALESCE(ns.system_notifications_enabled, 1) = 1
ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key);

INSERT INTO notification_broadcasts (admin_id, title, message, severity, created_at)
SELECT
  @admin_id,
  'Bảo mật tài khoản',
  'Không chia sẻ mật khẩu hoặc mã xác nhận. Nếu phát hiện hoạt động lạ, hãy đổi mật khẩu ngay trong phần tài khoản.',
  'CRITICAL',
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM notification_broadcasts
  WHERE title = 'Bảo mật tài khoản'
    AND message = 'Không chia sẻ mật khẩu hoặc mã xác nhận. Nếu phát hiện hoạt động lạ, hãy đổi mật khẩu ngay trong phần tài khoản.'
);

SET @broadcast_security_id := (
  SELECT id
  FROM notification_broadcasts
  WHERE title = 'Bảo mật tài khoản'
    AND message = 'Không chia sẻ mật khẩu hoặc mã xác nhận. Nếu phát hiện hoạt động lạ, hãy đổi mật khẩu ngay trong phần tài khoản.'
  ORDER BY id ASC
  LIMIT 1
);

INSERT INTO notifications (
  user_id,
  broadcast_id,
  type,
  severity,
  title,
  message,
  source_type,
  source_id,
  dedupe_key,
  created_at
)
SELECT
  u.id,
  @broadcast_security_id,
  'SYSTEM',
  'CRITICAL',
  'Bảo mật tài khoản',
  'Không chia sẻ mật khẩu hoặc mã xác nhận. Nếu phát hiện hoạt động lạ, hãy đổi mật khẩu ngay trong phần tài khoản.',
  'broadcast',
  @broadcast_security_id,
  'seed-system:security:v1',
  NOW()
FROM users u
LEFT JOIN notification_settings ns ON ns.user_id = u.id
WHERE COALESCE(u.is_active, 1) = 1
  AND COALESCE(ns.system_notifications_enabled, 1) = 1
ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key);
