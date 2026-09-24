# Chạy backend trên laptop để thử đồ án

Buổi thử APK qua mạng di động dự kiến thứ Sáu 25/09/2026; xem `mobile/APK_REMOTE_TEST_PLAN.md`. Chưa triển khai CH Play. Cấu hình địa chỉ API mobile hiện nằm ở `mobile/src/config/api.config.json`; script `mobile/scripts/configure-api.cjs` chọn chế độ nội bộ hoặc HTTPS từ xa.

Hướng dẫn này dành cho bản thử nghiệm. Laptop chạy backend và kết nối MySQL; điện thoại gửi yêu cầu đến backend. Dữ liệu không tự chuyển sang điện thoại khi tắt laptop. Laptop ngủ, mất mạng hoặc tắt backend thì các chức năng cần server sẽ không dùng được.

## 1. Cấu hình

Chạy các lệnh tại thư mục `backend`. Giữ cấu hình riêng trong `.env`, không đưa file này lên Git hay đóng gói vào app.

```dotenv
PORT=3000
HOST=0.0.0.0
```

`HOST=0.0.0.0` cho phép nhận kết nối qua các địa chỉ mạng của laptop. Nếu chỉ kiểm tra trên laptop hoặc chạy sau một reverse proxy/tunnel cùng máy, có thể dùng `HOST=127.0.0.1`. Điện thoại phải dùng địa chỉ IP LAN thực của laptop, không nhập `0.0.0.0` hay `localhost` làm địa chỉ server.

Các biến database, JWT, Google, email và Gemini dùng theo `.env.example` của dự án. Không thay khóa đăng nhập mỗi lần khởi động vì phiên đang dùng có thể mất hiệu lực. Không đưa khóa Gemini hoặc mật khẩu database vào cấu hình mobile.

Tối thiểu cần `DATABASE_URL` đúng với database thử và `JWT_SECRET` riêng của server. File mẫu đã liệt kê hai biến này cùng nhóm Google/SMTP tùy chọn; không ghi đè `.env` hiện tại bằng file mẫu. Đăng nhập email/mật khẩu bằng tài khoản thử có sẵn không yêu cầu Google, SMTP hoặc VNPay. Quên mật khẩu/gửi báo cáo qua email cần SMTP; thử riêng sau khi luồng đăng nhập và ghi thu chi hoạt động.

Token hết hạn/không hợp lệ trả HTTP 401 để app có thể làm mới phiên. Không truy cập được database khi xác minh tài khoản trả HTTP 503, không bị coi là sai quyền hoặc sai mật khẩu. Các chức năng bị giới hạn quyền vẫn có thể trả HTTP 403.

## 2. Kiểm tra trước khi chạy

```powershell
npm ci
npm run build
npm run start:prod
```

MySQL và schema phải sẵn sàng trước khi backend khởi động. Không dùng lệnh reset database để sửa lỗi kết nối. Sau khi cập nhật code, cần build lại trước `start:prod`.

Mở một terminal khác để kiểm tra tiến trình HTTP:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Kết quả đúng có `status: ok` và `service: quan-ly-chi-tieu`. Endpoint không trả secret và không kiểm tra database trên từng lần gọi; sau đó cần thử đăng nhập và đọc danh sách ví bằng tài khoản thử để kiểm tra cả luồng dữ liệu.

Backend và mobile cần cập nhật cùng nhau: mobile dùng endpoint `/health` để chọn server trước lần gửi thao tác ghi đầu tiên nếu chưa xác định được server từ thao tác đọc.

## 3. Kết nối điện thoại cùng Wi-Fi

1. Xem IPv4 của Wi-Fi laptop bằng `ipconfig`.
2. Trên trình duyệt điện thoại, mở `http://IP_LAPTOP:3000/health`.
3. Nếu laptop tự truy cập được nhưng điện thoại không được: kiểm tra cùng mạng, chế độ cách ly thiết bị trên Wi-Fi và quyền nhận kết nối của Windows Firewall. Chỉ mở đúng cổng ứng dụng trên mạng riêng khi cần, không tắt toàn bộ firewall.
4. Tại thư mục `mobile`, chạy `node scripts/configure-api.cjs --local`, rồi đối chiếu địa chỉ LAN trong `src/config/apiEndpoints.ts` với IP laptop. Địa chỉ `192.168.1.3` mặc định chỉ phù hợp nếu laptop thực sự có IP đó. `10.0.2.2` dành cho môi trường giả lập, không phải địa chỉ điện thoại thật. Build lại APK sau khi đổi cấu hình. Khi thử từ xa qua HTTPS, dùng `--remote https://TEN_MIEN_SERVER` theo `mobile/APK_REMOTE_TEST_PLAN.md`.

Địa chỉ LAN và HTTP chỉ phù hợp cho bản thử trong mạng tin cậy. Trước phát hành cần URL HTTPS ổn định và cấu hình riêng cho bản phát hành. Chưa thiết lập URL công khai trong đợt sửa này.

## 4. Khi có lỗi

| Biểu hiện | Kiểm tra |
|---|---|
| `/health` không trả lời trên laptop | Backend có đang chạy, PORT có đúng, cổng có bị tiến trình khác chiếm không |
| `/health` trả lời nhưng đăng nhập/đọc ví lỗi | Log backend, kết nối MySQL, schema và cấu hình đăng nhập |
| Laptop truy cập được, điện thoại không được | IP hiện tại, cùng Wi-Fi, HOST, firewall, cách ly thiết bị |
| App báo kết quả lưu chưa xác định | Kiểm tra lịch sử và số dư trước khi bấm lưu lại; có thể server đã ghi nhưng phản hồi bị mất |
| Sau khởi động lại vẫn chạy code cũ | Build lại rồi dừng tiến trình cũ và khởi động `start:prod` |

Dừng bằng Ctrl+C trước khi đóng terminal; backend có shutdown hook để đóng kết nối Prisma. Không khởi chạy nhiều bản backend chỉ để thử sửa lỗi cổng.

## 5. Sao lưu và phục hồi còn phải hoàn tất

- Sao lưu cả MySQL và thư mục `uploads`; chỉ sao lưu code không đủ khôi phục hóa đơn, avatar và dữ liệu người dùng.
- Đặt bản sao ở thiết bị hoặc vị trí khác laptop đang chạy server. Ghi lại ngày giờ, phiên bản schema/code và số lượng bản ghi chính.
- Trước mỗi thay đổi schema, tạo bản sao và thử phục hồi vào database riêng. Không phục hồi thử lên database đang dùng.
- Kiểm tra sau phục hồi: đăng nhập, tổng số giao dịch, số dư ví, khoản vay/nợ, mục tiêu, liên kết hashtag và mở ảnh mẫu.
- Chưa tạo hoặc thử phục hồi bản sao lưu trong đợt này. Chưa cấu hình tự khởi động sau khi Windows restart, giám sát hay tunnel.
- Kiểm tra ngày 21/09 chưa tìm thấy `mysqldump` trên PATH hoặc các vị trí MySQL/XAMPP phổ biến đã kiểm tra. Chưa kết luận công cụ chưa được cài; cần xác định MySQL hiện chạy ở đâu và công cụ xuất/khôi phục tương ứng trước buổi thử. Không coi việc copy thư mục code là bản sao database.
