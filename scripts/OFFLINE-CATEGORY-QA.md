# Kiểm thử Danh mục offline — 20–21/11/2026

Chỉ dùng database QA tách biệt và server QA loopback cổng 3303. Server production cổng 3000 không bị dừng, migrate hoặc khởi động lại.

## Thay đổi backend

- Migration `20261120000100_category_request_key` thêm `client_request_id` vào `categories`, unique theo tài khoản để POST lặp cùng mã không tạo danh mục trùng.
- Sửa và xóa khi đồng bộ nhận `offline_expected` để đối chiếu tên, loại, nhóm dòng tiền và icon gốc. Nếu bản máy chủ đã khác, trả 409 và giữ thay đổi trên điện thoại để người dùng chọn.
- Các API cũ không có hai trường mới tiếp tục hoạt động theo luồng cũ.

## Bằng chứng

- Dùng worktree backend riêng để tạo Prisma Client và chạy API QA vì query engine ở repo chính đang được server production sử dụng. Migration chỉ được áp dụng vào schema `nova_qa_bills_20261026_*` trên `127.0.0.1`.
- `src/categories/categories.service.spec.ts`: 14/14 ca Jest đạt, gồm mã yêu cầu lặp, mã trùng nhưng payload khác, sửa/xóa trên bản gốc cũ.
- `node scripts/verify-offline-category-http-qa.cjs`: POST đầu 201; POST lặp cùng ID 201; mã cũ với tên khác 409; PUT 200; PUT/DELETE trên snapshot cũ 409; DELETE snapshot đúng 200; database QA có một dòng cho mã yêu cầu. Script xác nhận hostname/schema/email QA và phục hồi role ban đầu trong `finally`.
- Android QA: tạo/sửa/xóa sau khi mất API, xem trước và chọn bản máy; database QA ID 39 được tạo một lần, sửa tên, sau đó xóa mềm. [Ảnh và bước thử](../../mobile/qa/evidence/2026-11-20-offline-categories/README.md).

## Khi chuẩn bị phát hành

Áp dụng migration production **trước** khi triển khai backend và app có `client_request_id`; kiểm tra backup, schema, health và đường quay lui theo quy trình triển khai. Trong đợt này chưa thay production hoặc phát hành APK.
