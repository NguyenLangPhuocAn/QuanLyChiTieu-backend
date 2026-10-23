# AI trích xuất thông báo ngân hàng — source 23/10/2026

Chưa deploy lên server đang chạy, chưa bật cờ thực tế hoặc phát hành APK mới.

## Luồng

Lắc/chuông chọn notification mới nhất → lọc dữ liệu nhạy cảm → kiểm tra cờ → xem/đồng ý gửi chữ (một lần hoặc nhớ theo tài khoản) → Gemini JSON → đối chiếu an toàn → bản nháp cần người dùng chọn ví và Save. Không chụp/upload ảnh, không tự ghi tiền.

- GET /features yêu cầu JWT, chỉ trả bank_notification_ai. Mặc định FEATURE_BANK_NOTIFICATION_AI=false.
- POST /bank-notifications/extract yêu cầu JWT, text 5–800 ký tự và consent=true. Chặn OTP/mật khẩu, che tài khoản/mã tham chiếu và bỏ số dư trước model. Bộ che là biện pháp giới hạn dữ liệu, không cam kết nhận biết mọi thông tin cá nhân; app hiển thị chữ gửi và yêu cầu đồng ý.
- AI là bộ trích xuất chính. Không dùng unique-money/direction keyword để chọn trường trước model; có phí thì model chọn tiền chính. Sau model vẫn đối chiếu literal tiền/tệ, dấu trong bằng chứng nguyên văn, confidence >=0.9 và mô tả hợp lệ. Không khớp thì REVIEW, không đoán thay bằng regex. Các định dạng tiền chưa đối chiếu được vẫn cần nhập tay.
- Gemini generationConfig có responseJsonSchema, maxOutputTokens=600, temperature=0, timeout=12s; client 16s. Không đổi model đang cấu hình và mặc định chatbot/OCR khác.
- Giới hạn một upstream đồng thời, 3 lần/phút/tài khoản, tối đa 1.000 bucket trong RAM; lỗi vẫn tính vào hạn mức. Cần bộ đếm chung nếu chạy nhiều instance.
- Trả requires_confirmation=true và visibility_verified=false. Không có ví, transaction id hay thao tác ghi database trong service.

## Client và hủy

Quyền AI được nhớ theo tài khoản và có mục đặt lại. Không gửi chữ khi người dùng chọn Nhập tay, cờ tắt hoặc server cũ chưa có endpoint. Cùng source/nội dung cache RAM 2 phút; session/account/content khác không dùng lại. Feature flag cache 30s khi bật, 3s khi tắt; server vẫn kiểm tra mỗi extract. Không lưu nội dung vào kho quyền.

Hủy client abort HTTP/bỏ kết quả muộn. Upstream đã gửi có thể tiếp tục hoàn tất trong timeout; không hứa hủy xóa dữ liệu đã gửi tới provider. Chỉ Save/enqueue an toàn mới markProcessed.

## Bằng chứng và phần chưa đạt

- Backend 73/73 qua 5 bộ (flag/service/HTTP/Gemini/OCR); mobile 100/100 qua 9 bộ. TypeScript, ESLint và compile Kotlin đạt. Provider/model được mock.
- Chưa gọi Gemini thật, chưa đo tốc độ/độ chính xác, chưa thử native notification/gesture trên máy thật. JSON hợp schema không có nghĩa là mọi dữ liệu đều đúng.
- Trước sử dụng: deploy môi trường thử, bật FEATURE_BANK_NOTIFICATION_AI=true theo lịch restart đã được chấp thuận, thử bộ mẫu ẩn danh và lỗi/quota. Không sửa .env hoặc restart server ổn định chỉ để thử.
- Checklist thiết bị: mobile/qa/BANK-NOTIFICATIONS.md. Snapshot notification không chứng minh heads-up banner nào đang nổi.

Tham khảo API: https://ai.google.dev/api/generate-content#generationconfig
