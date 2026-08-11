UPDATE categories
SET name = 'Lương'
WHERE id = 79 AND name = 'L??ng';

UPDATE categories
SET name = 'Thưởng/Freelance'
WHERE id = 80 AND name = 'Th??ng/Freelance';

UPDATE categories
SET name = 'Ăn uống'
WHERE id = 81 AND name = '?n u?ng';

UPDATE categories
SET name = 'Di chuyển'
WHERE id = 82 AND name = 'Di chuy?n';

UPDATE categories
SET name = 'Hóa đơn'
WHERE id = 83 AND name = 'H?a ??n';

UPDATE categories
SET name = 'Giáo dục'
WHERE id = 84 AND name = 'Gi?o d?c';

UPDATE categories
SET name = 'Mua sắm'
WHERE id = 85 AND name = 'Mua s?m';

UPDATE categories
SET name = 'Du lịch'
WHERE id = 86 AND name = 'Du l?ch';

UPDATE categories
SET name = 'Giải trí'
WHERE id = 87 AND name = 'Gi?i tr?';

UPDATE budgets
SET name = 'BASIC thật - Ăn uống tháng 5'
WHERE id = 34 AND name = 'BASIC th?t - ?n u?ng th?ng 5';

UPDATE budgets
SET name = 'BASIC thật - Ngân sách tùy chọn'
WHERE id = 35 AND name = 'BASIC th?t - Ng?n s?ch t?y ch?n';

UPDATE budgets
SET name = 'Premium thật - USD tháng 5'
WHERE id = 36 AND name = 'Premium th?t - USD th?ng 5';

UPDATE budgets
SET name = 'Premium thật - Du lịch JPY tùy chọn'
WHERE id = 37 AND name = 'Premium th?t - Du l?ch JPY t?y ch?n';

UPDATE budgets
SET name = 'Premium thật - GBP năm 2026'
WHERE id = 38 AND name = 'Premium th?t - GBP n?m 2026';

UPDATE tags SET name = 'lương' WHERE id = 164 AND name = 'l??ng';
UPDATE tags SET name = 'ăn uống' WHERE id = 165 AND name = '?n u?ng';
UPDATE tags SET name = 'học tập' WHERE id = 166 AND name = 'h?c t?p';
UPDATE tags SET name = 'du lịch' WHERE id = 170 AND name = 'du l?ch';

UPDATE admin_logs
SET action = 'Người dùng đăng nhập hệ thống'
WHERE id = 122 AND action = 'Ng??i d?ng ??ng nh?p h? th?ng';

UPDATE notifications
SET title = 'Sắp chạm ngân sách',
    message = 'Tài khoản BASIC thật đã có cảnh báo ngân sách để kiểm thử thông báo.'
WHERE id = 8;

UPDATE notifications
SET title = 'Dữ liệu BASIC sẵn sàng',
    message = 'Dùng tài khoản này để test giới hạn BASIC, giao dịch, ngân sách và thông báo.'
WHERE id = 9;

UPDATE notifications
SET title = 'Vượt ngân sách đa tiền tệ',
    message = 'Dùng thông báo này để kiểm thử cảnh báo ngân sách Premium nhiều loại tiền.'
WHERE id = 10;

UPDATE notifications
SET title = 'Dữ liệu Premium đa tiền tệ sẵn sàng',
    message = 'Ví USD, EUR, JPY, KRW, CHF, GBP đã có giao dịch để test thống kê quy đổi USD.'
WHERE id = 11;

UPDATE transactions
SET note = 'Lương tháng 5 - tài khoản BASIC thật'
WHERE id = 594 AND note = 'L??ng th?ng 5 - t?i kho?n BASIC th?t';

UPDATE transactions
SET note = 'Ăn uống cuối tuần - tài khoản BASIC thật'
WHERE id = 595 AND note = '?n u?ng cu?i tu?n - t?i kho?n BASIC th?t';

UPDATE transactions
SET note = 'Tài liệu học chuyên ngành - tài khoản BASIC thật'
WHERE id = 596 AND note = 'T?i li?u h?c chuy?n ng?nh - t?i kho?n BASIC th?t';

UPDATE transactions
SET note = 'Lương remote USD - tài khoản Premium thật'
WHERE id = 597 AND note = 'L??ng remote USD - t?i kho?n Premium th?t';

UPDATE transactions
SET note = 'Khách sạn EUR - tài khoản Premium thật'
WHERE id = 598 AND note = 'Kh?ch s?n EUR - t?i kho?n Premium th?t';

UPDATE transactions
SET note = 'Ramen Nhật JPY - tài khoản Premium thật'
WHERE id = 599 AND note = 'Ramen Nh?t JPY - t?i kho?n Premium th?t';

UPDATE transactions
SET note = 'Mua sắm KRW - tài khoản Premium thật'
WHERE id = 600 AND note = 'Mua s?m KRW - t?i kho?n Premium th?t';

UPDATE transactions
SET note = 'Lãi tiết kiệm CHF - tài khoản Premium thật'
WHERE id = 601 AND note = 'L?i ti?t ki?m CHF - t?i kho?n Premium th?t';

UPDATE transactions
SET note = 'Freelance GBP - tài khoản Premium thật'
WHERE id = 602 AND note = 'Freelance GBP - t?i kho?n Premium th?t';

UPDATE transactions
SET note = 'Hóa đơn VND - tài khoản Premium thật'
WHERE id = 603 AND note = 'H?a ??n VND - t?i kho?n Premium th?t';
