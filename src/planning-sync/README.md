# Đồng bộ lịch tiền

API mới, chưa triển khai lên server đang dùng. Chỉ chứa lịch hóa đơn, trạng thái kỳ, lựa chọn gợi ý/cảnh báo và các khoản thu/chi dự kiến. Không tạo giao dịch hoặc thay số dư.

- `GET /planning-sync`: JWT bắt buộc. Chưa có bản lưu trả revision0/snapshot null.
- `PUT /planning-sync`: `{revision, snapshot}`. Danh tính lấy từ JWT, không nhận userId để chọn tài khoản khác. Snapshot version1 gồm book version1 và plans.
- Ghi có điều kiện theo revision trong một transaction MySQL. Hai bản khác nhau cùng phiên bản: một thành công, một409. Gửi lại cùng nội dung sau mất phản hồi trả bản đã lưu, không tăng revision lần nữa.
- Dữ liệu tối đa512KiB UTF-8, danh sách có giới hạn, kiểm ngày lịch/số tiền/chu kỳ/ID trùng/liên kết kỳ. SQL tham số hóa. JSON được chuẩn hóa thứ tự khóa để so với MySQL JSON.

Ứng dụng chỉ gọi sau khi người dùng xem trước và xác nhận bật. Mặc định lưu trên máy. Khi bật, app đang mở và có mạng sẽ đồng bộ sau thay đổi, khi trở lại app/có mạng và kiểm tra mỗi30giây. Không đồng bộ khi Android force-stop. Mất mạng giữ bản local; hai bên cùng thay đổi thì giữ hai bản, hiện lựa chọn. Đây là chọn toàn bộ một bản, chưa ghép từng dòng xung đột. Bật/tắt nhắc là lựa chọn riêng từng điện thoại, không lấy trạng thái bật của máy khác.

## Triển khai trong đợt cập nhật được chốt

1. Kiểm tra và sao lưu database đúng môi trường. Bảng mới `planning_snapshots` có khóa ngoại users.id và chỉ một hàng mỗi tài khoản. Source DDL ở `prisma/migrations/20261031000100_planning_snapshots/migration.sql`.
2. Đây là repository đang dùng database có sẵn. Không chạy migrate reset hoặc migrate deploy mù khi chưa kiểm baseline lịch sử migration. Chỉ áp dụng DDL tạo bảng mới nếu chưa tồn tại; không đổi bảng giao dịch/ví.
3. Triển khai backend hỗ trợ API, kiểm health,401 khi thiếu JWT, kiểm hai tài khoản độc lập và CAS trước khi đưa bản app mới tới người dùng.
4. Server cũ thiếu API hoặc bảng mới thì app giữ dữ liệu local. Thiếu bảng trả503 rõ ràng. Chưa có chuyển đổi dữ liệu server khi rollback ứng dụng.

## Bằng chứng local31/10/2026

- `planning-sync.service.spec.ts`: validation, cô lập tài khoản, phiên bản, replay và rollout thiếu bảng.
- `scripts/planning-sync-qa.cjs`: chỉ nhận schema QA local có tên kiểm chặt, thêm bảng metadata vào schema đó, HTTP JWT/MySQL thật trên3303. Không thay server ổn định3000 hoặc dữ liệu tiền QA.
- Quy trình QA không phải hướng dẫn migrate production. Chưa phát hành APK trong đợt này.
