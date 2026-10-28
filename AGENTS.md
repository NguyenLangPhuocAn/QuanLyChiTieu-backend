# Quy ước làm việc

- Sau mỗi đợt thay đổi đã kiểm tra, commit/push mã nguồn lên GitHub và xác nhận HEAD khớp origin. Không đưa .env, token, mật khẩu hoặc dữ liệu người dùng vào Git.
- Giữ server đang dùng ổn định. Kiểm thử có ghi dữ liệu phải dùng database/tài khoản QA riêng; không reset/migrate/seed database hiện tại để phục vụ test.
- Khi báo kết quả, phân biệt kiểm thử mock, backend local/MySQL thật, Android giả lập và điện thoại thật; chỉ đánh dấu đạt khi có bằng chứng.

- Theo yêu cầu ngày28/10/2026: tất cả file sao lưu dùng file thường, không mã hóa/không hỏi mật khẩu. Chỉ thay đổi lại khi người dùng yêu cầu mới.
