# Trích xuất nội dung thông báo — source thử nghiệm

Ngày: 23/10/2026. Chưa triển khai lên server đang chạy. Source mobile đã có phiên chụp/crop/OCR và nút đồng ý gửi chữ; chưa có APK mới hoặc thử thiết bị thật.

## Phạm vi đã có

- `GET /features`, yêu cầu JWT, chỉ trả `bank_notification_ai`.
- `POST /bank-notifications/extract`, yêu cầu JWT, body `{ "text": "...", "consent": true }`.
- Giới hạn 800 ký tự; từ chối OTP/mật khẩu; che số tài khoản và mã tham chiếu, bỏ số dư trước khi gọi model.
- Mọi số tiền trả về phải xuất hiện trong nội dung đã che và có bằng chứng nguyên văn về chiều thu/chi. Nhiều số tiền, thiếu bằng chứng hoặc kết quả không khớp trả `REVIEW` với số tiền rỗng.
- Giới hạn một yêu cầu model đồng thời và tối đa 3 lần/phút cho mỗi tài khoản, tối đa 1.000 tài khoản trong bộ đếm của một tiến trình. Lỗi upstream vẫn tính vào hạn mức. Nhiều instance cần bộ đếm dùng chung trước khi mở rộng vận hành.
- Kết quả chỉ là bản nháp, không chứa ví hay mã giao dịch đã lưu. Service không có kết nối ghi database.
- `visibility_verified: false` luôn được trả về: trích xuất văn bản không chứng minh rằng nguồn là banner đang nổi.

## Bật/tắt

Mặc định tính năng tắt. Trong môi trường thử riêng, cấu hình `FEATURE_BANK_NOTIFICATION_AI=true`, sau đó khởi động backend theo lịch bảo trì. Thay đổi `.env` không tự thay đổi tiến trình đang chạy. Không chỉnh `.env` hiện tại hoặc restart server ổn định để thử tính năng.

Các cờ cho hóa đơn định kỳ, giọng nói và phản hồi beta chưa được quảng bá trong API vì chưa có phần backend tương ứng. File START/STOP-BACKEND quản lý tiến trình, khác với cờ bật/tắt tính năng này.

## Tích hợp mobile và phần còn cần kiểm tra

- Người dùng đã chọn quyền chụp màn hình theo phiên. Mobile chụp khi bấm chuông, chọn vùng một banner và OCR trên máy; không gửi ảnh vào endpoint này.
- App hiển thị phần chữ đã che để xin đồng ý trước mỗi lần gọi AI. Khi cờ tắt/endpoint chưa có, báo rõ và cho nhập tay; không làm hỏng luồng OCR cục bộ.
- Phân tích cục bộ và backend cùng bỏ số dư, kể cả nhãn/số nằm khác dòng OCR. Backend vẫn kiểm tra lại dữ liệu; không tin dữ liệu client.
- 55/55 kiểm thử mới (mock Gemini), TypeScript và ESLint đạt. Chưa thử model thật trong môi trường thử; chưa có bằng chứng độ chính xác banner trên thiết bị thật.
- Trước khi sử dụng AI thật: triển khai thử riêng, kiểm tra sự đồng ý, dữ liệu đầu vào và lỗi upstream. Không bật cờ hoặc restart server ổn định trong đợt này.
- Kiểm tra cache, quyền, ảnh không có banner, OEM chặn chụp, đa thông báo và thu hồi quyền theo `mobile/qa/BANK-BANNER-CAPTURE.md`.
