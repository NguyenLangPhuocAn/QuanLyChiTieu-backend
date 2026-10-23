# Trích xuất nội dung thông báo — source thử nghiệm

Ngày: 23/10/2026. Chưa triển khai lên server đang chạy. Source mobile đã đổi sang đọc chữ thông báo trực tiếp qua lắc/chuông, không gọi AI trong luồng rút gọn; chưa có APK mới hoặc thử thiết bị thật.

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

- Theo yêu cầu tối ưu thao tác, mobile hiện đọc trực tiếp chữ thông báo Android bằng lắc/chuông, mới nhất trước. Luồng chụp/crop/OCR đã gỡ; không gửi ảnh tới backend.
- Luồng lắc phân tích cục bộ, không gọi endpoint AI này và chưa có UI AI trong form rút gọn. Adapter client cho phân tích chữ vẫn có kiểm thử để dùng khi bổ sung bước đồng ý sau này.
- API nguồn luôn yêu cầu consent=true và kiểm tra/che lại dữ liệu; tuyệt đối không dựa vào việc client đã che.
- Giữ mốc 55/55 kiểm thử (mock Gemini), TypeScript và ESLint đạt. Chưa thử model thật, deploy, sửa .env hay restart server ổn định.
- Trước khi dùng AI thật: thiết kế bước xem/đồng ý gửi chữ, triển khai thử riêng, kiểm tra sự đồng ý, dữ liệu và upstream. Không tự bật theo thao tác lắc.
- Kiểm tra native ở mobile/qa/BANK-NOTIFICATIONS.md; chưa có APK mới hay nghiệm thu cảm biến/notification thực.
