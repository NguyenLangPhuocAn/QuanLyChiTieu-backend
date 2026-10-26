# Backend/MySQL riêng cho kiểm thử hóa đơn định kỳ

Đây là môi trường local dùng source Nest hiện tại và MySQL thật; không phải API mock. Không migrate/reset/seed database đang dùng.

## Chuẩn bị schema mới

`node scripts/prepare-recurring-bills-qa.cjs --admin-config PATH_TO_PRIVATE_ADMIN_JSON`

- `DATABASE_URL` cục bộ chỉ được dùng để xác định MySQL loopback. JSON quản trị nằm ngoài Git, gồm `user`, `password`, `port`; không gửi giá trị vào chat/log.
- Chỉ cho host localhost/127.0.0.1. Script tạo tên schema mới có tiền tố `nova_qa_bills_20261026_`, tạo tài khoản MySQL mới chỉ có quyền trên schema đó, rồi đẩy Prisma schema vào đúng schema mới.
- Tạo một tài khoản ứng dụng QA, một ví, một danh mục và hai khoản Chi có dấu âm theo quy ước database. Mật khẩu được tạo ngẫu nhiên. Bản fixture không chứa dữ liệu thật của người dùng.
- Session nằm trong `.runtime/recurring-bills-qa/session.json` đã được Git ignore. Không đưa file này vào ảnh, biên bản hoặc commit. Script không tự xóa schema cũ khi chạy lại.

## Chạy và xác nhận

1. Xác nhận cổng 3000 trống và không có tunnel trỏ vào server QA. Không dừng server đang dùng để lấy cổng.
2. `node scripts/run-recurring-bills-qa.cjs`: chạy source qua ts-node, chỉ bind 127.0.0.1. Dùng JWT secret riêng, tắt API AI; không thay .env.
3. `node scripts/verify-recurring-bills-http-qa.cjs`: đăng nhập thật và kiểm tra health/profile/wallets/giao dịch qua HTTP local; chứng cứ chỉ lưu trạng thái, không lưu token.
4. `node scripts/inspect-recurring-bills-qa.cjs`: đối chiếu trực tiếp database QA. Hai giao dịch và số dư 6.590.000đ phải giữ nguyên trước/sau các thao tác chỉ liên kết hóa đơn.
5. Thực hiện luồng Android theo `mobile/qa/LOCAL-ANDROID.md`. Khi hết buổi thử, dừng đúng tiến trình QA, không restart/deploy server production hoặc mở tunnel.

Việc tạo schema cần quyền quản trị MySQL cục bộ. Tài khoản ứng dụng production có thể bị từ chối CREATE DATABASE; đó là giới hạn đúng, không phải lỗi API. Script không nâng quyền tài khoản production.
