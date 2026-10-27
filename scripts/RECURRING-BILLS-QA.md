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

## Fixture gợi ý khoản chi lặp — 27/10/2026

- `node scripts/bill-suggestions-qa.cjs --prepare` tạo thêm tài khoản/ví riêng và9khoản chi giả trong đúng schema QA đã chuẩn bị. Không migrate/reset, không thay tài khoản/ví/hai giao dịch cũ. Chỉ cho MySQL loopback và tên schema QA đúng tiền tố. Internet có3kỳ biến thiên240–260nghìn; Video/Music mỗi nhóm3kỳ cố định. Số dư ví mới8.848.000đ.
- Session mới lưu ở `.runtime/bill-suggestions-qa/session.json`, luôn ngoài Git. Nếu file đã có, lệnh chỉ đối chiếu fixture, không seed thêm. Mật khẩu/JWT/database URL không được in vào biên bản.
- Server vẫn dùng `node scripts/run-recurring-bills-qa.cjs`, chỉ cổng local trống như trên. `node scripts/verify-bill-suggestions-http-qa.cjs` đăng nhập thật bằng tài khoản mới, kiểm tra profile và GET lịch sử9/9, chỉ ghi bằng chứng không chứa token.
- `node scripts/bill-suggestions-qa.cjs` kiểm tra9ID/nội dung/ngày/số tiền và số dư mới; chạy thêm `node scripts/inspect-recurring-bills-qa.cjs` xác nhận2giao dịch/số dư cũ giữ nguyên. Luồng Android local và75ảnh nằm trong repo mobile ở `qa/evidence/2026-10-27-bill-suggestions/`.
- Không đổi logic ứng dụng backend trong batch này. Các script chỉ phục vụ QA; không bật AI, sửa `.env`, restart production hoặc mở tunnel. Kết thúc kiểm thử dừng đúng tiến trình QA do buổi thử tạo.
