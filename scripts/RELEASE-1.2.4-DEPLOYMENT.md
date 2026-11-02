# Backend cho app1.2.4 — 02/11/2026

Người dùng đã xác nhận cập nhật backend cùng APK. Đã kiểm377/377, biên dịch trước khi thay dist. Bổ sung đúng bảng planning_snapshots; tài khoản app không có CREATE nên dùng tài khoản quản trị local có sẵn để tạo bảng, không thay cấp quyền hay các bảng tiền. DML bằng tài khoản app đạt.

Một lần restart tiến trình server3000 sau khi thay compiled dist. Dist cũ được giữ trong thư mục runtime pre-release-1.2.4-20261102 để quay lui; không đưa file runtime hoặc thông tin kết nối vào Git. Health local và public trả200, GET/planning-sync thiếuJWT trả401. Kiểm thử có ghi tiền chỉ dùng QA3303/database riêng.

Source triển khai là baseline259a556; lần này bổ sung helper repeat-transaction-qa.cjs và biên bản, không thay thêm logic API. Helper kiểm preview không đổi tiền, một lần xác nhận ghi đúng một khoản, replay hai lần không ghi thêm. Lượt replay phải giữ hashtag qa đúng payload client.

Quay lui: dừng đúng tiến trình đang nghe3000, giữ dist mới riêng, khôi phục dist cũ từ runtime và chạy lại lệnh server hiện có. Không xóa bảng mới hoặc reset dữ liệu; kiểm health sau khôi phục. Không cần quay lui hiện tại vì health và kiểm tra bảo vệ endpoint đạt.
