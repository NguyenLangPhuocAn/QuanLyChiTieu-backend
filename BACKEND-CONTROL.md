# Bật, tắt và xem trạng thái backend trên Windows

- `STATUS-BACKEND.cmd`: kiểm tra cổng 3000, tiến trình có thuộc dự án và `/health`.
- `START-BACKEND.cmd`: chạy bản backend đã build, hoặc giữ nguyên nếu đang chạy ổn định.
- `STOP-BACKEND.cmd`: dừng đúng tiến trình Node của dự án đang giữ cổng 3000.

Đặt `.env` trong thư mục `backend`, chạy MySQL trước. Nếu chưa có bản build, chạy `npm run build` riêng trong thư mục backend. Bộ điều khiển không tự build hay sửa cấu hình, không tạo APK, không bật/tắt database hoặc tunnel. Log của phiên được bật bằng file này nằm trong `backend/.runtime/` và không đưa lên Git.

Script nhận diện tiến trình qua đường dẫn đầy đủ của `dist/src/main.js` hoặc launcher cũ `laptop-server.cjs`. Nếu cổng thuộc tiến trình khác hoặc không xác minh được, script báo lỗi và giữ nguyên tiến trình đó. Nếu backend đang chạy nhưng health lỗi, xem log trước khi chọn dừng/bật lại.

Phiên backend hiện tại được bật bằng đường dẫn tương đối `dist/src/main.js`, vì vậy script mới chưa xác minh được quyền sở hữu phiên này. Không dùng script để cố dừng phiên đang ổn định. Trong lần bảo trì đã lên lịch, dừng bằng công cụ đã bật phiên cũ rồi dùng `START-BACKEND.cmd`; các lần sau script sẽ nhận đúng đường dẫn tuyệt đối.

Đổi cổng khi cần bằng PowerShell:

```powershell
.\scripts\backend-control.ps1 -Action status -Port 3001
```

Kiểm tra `status` chỉ xác nhận HTTP health. Endpoint hiện tại chưa kiểm tra kết nối database; cần thử một API dữ liệu sau khi bật để xác nhận đầy đủ. Mất mạng ngoài điện thoại còn có thể do DNS/tunnel, không nên restart backend liên tục chỉ vì điện thoại báo lỗi kết nối.
