import { statSync } from 'fs';
import {
  buildEmailInlineAttachments,
  buildNewAccountEmailHtml,
  buildNotificationEmailHtml,
  buildReportEmailHtml,
  buildResetOtpEmailHtml,
  buildTemporaryPasswordEmailHtml,
} from './html-email';

describe('email html templates', () => {
  it('uses the app wallet icon instead of the old QL badge', () => {
    const html = buildResetOtpEmailHtml({
      otp: '123456',
      expiresInMinutes: 10,
    });

    expect(html).toContain('aria-label="App wallet icon"');
    expect(html).toContain('wallet-app-icon');
    expect(html).toContain('src="cid:app-wallet-icon"');
    expect(html).toContain('width="42" height="42"');
    expect(html).not.toContain('>QL<');
    expect(html).not.toContain('>đ<');
    expect(html).not.toContain('>₫<');
    expect(buildEmailInlineAttachments()).toEqual([
      expect.objectContaining({
        cid: 'app-wallet-icon',
        filename: 'app-wallet-icon.png',
      }),
    ]);
  });

  it('keeps the inline app icon small enough for fast email loading', () => {
    const [icon] = buildEmailInlineAttachments();

    expect(icon).toBeDefined();
    expect(statSync(icon.path).size).toBeLessThan(50_000);
  });

  it('renders OTP content without generic status or sent time blocks', () => {
    const html = buildResetOtpEmailHtml({
      otp: '123456',
      expiresInMinutes: 10,
    });

    expect(html).toContain('123456');
    expect(html).toContain('10 phút');
    expect(html).not.toContain('Trạng thái');
    expect(html).not.toContain('Thời gian');
  });

  it('renders report, account, temporary password, and notification content for their own contexts', () => {
    const reportHtml = buildReportEmailHtml({
      recipientName: 'Nguyễn Lăng Phước An',
      periodLabel: 'tháng này',
      rangeLabel: '01/06/2026 - 30/06/2026',
      income: '12.000.000 VND',
      expense: '4.500.000 VND',
      net: '7.500.000 VND',
      transactionCount: 28,
    });
    expect(reportHtml).toContain('Tổng chi');
    expect(reportHtml).not.toContain('Mẹo nhỏ');
    expect(reportHtml).not.toContain('khoản vay/nợ');

    expect(
      buildNewAccountEmailHtml({
        email: 'nlpan14112004@gmail.com',
        temporaryPassword: 'Temp@123',
      }),
    ).toContain('Tài khoản của bạn đã sẵn sàng');

    const temporaryPasswordHtml = buildTemporaryPasswordEmailHtml({
      temporaryPassword: 'Temp@456',
    });
    expect(temporaryPasswordHtml).toContain('Mật khẩu tạm thời');
    expect(temporaryPasswordHtml).toContain('Mật khẩu tạm được cấp');
    expect(temporaryPasswordHtml).not.toContain('cấp lại mật khẩu');

    const notificationHtml = buildNotificationEmailHtml({
      recipientName: 'Nguyễn Lăng Phước An',
      title: 'Thông báo kiểm tra',
      message:
        'Đây là email test/thông báo dùng chung khung giao diện của hệ thống.',
    });

    expect(notificationHtml).toContain('Thông báo kiểm tra');
    expect(notificationHtml).not.toContain('Trạng thái');
    expect(notificationHtml).not.toContain('Thời gian');
  });
});
