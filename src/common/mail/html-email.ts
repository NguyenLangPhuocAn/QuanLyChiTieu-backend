import { existsSync } from 'fs';
import { resolve } from 'path';

type ReportEmailInput = {
  recipientName: string;
  periodLabel: string;
  rangeLabel: string;
  income: string;
  expense: string;
  net: string;
  transactionCount: number;
  topCategories?: string[];
  methodology?: string;
};

type NewAccountEmailInput = {
  email: string;
  temporaryPassword: string;
};

type ResetOtpEmailInput = {
  otp: string;
  expiresInMinutes: number;
};

type TemporaryPasswordEmailInput = {
  temporaryPassword: string;
};

type NotificationEmailInput = {
  title: string;
  message: string;
  recipientName?: string;
  subtitle?: string;
  actionLabel?: string;
  actionUrl?: string;
};

const APP_NAME = 'Quản lý chi tiêu';
const APP_SLOGAN = 'Quản tiền rõ ràng, sống nhẹ nhàng hơn.';
export const MAIL_ICON_CID = 'app-wallet-icon';
const MAIL_ICON_FILENAME = 'app-wallet-icon.png';

const escapeHtml = (value: string | number) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const paragraph = (value: string) => `
  <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3f2a1d;">${escapeHtml(value)}</p>`;

const infoBox = (label: string, value: string, color = '#c2410c') => `
  <div style="border:1px solid #f2d3b8;border-radius:12px;padding:14px 16px;background:#fffaf5;margin:0 0 12px;">
    <div style="font-size:12px;color:#7a5a44;font-weight:800;margin-bottom:6px;">${escapeHtml(label)}</div>
    <div style="font-size:18px;font-weight:900;color:${color};line-height:1.35;">${escapeHtml(value)}</div>
  </div>`;

const statCard = (label: string, value: string, color: string) => `
  <td style="width:50%;padding:8px;">
    <div style="border:1px solid #f2d3b8;border-radius:12px;padding:14px;background:#fffaf5;">
      <div style="font-size:12px;color:#7a5a44;font-weight:800;margin-bottom:6px;">${escapeHtml(label)}</div>
      <div style="font-size:19px;color:${color};font-weight:900;line-height:1.3;">${escapeHtml(value)}</div>
    </div>
  </td>`;

const walletIcon = `
  <div class="wallet-app-icon" role="img" aria-label="App wallet icon" style="width:48px;height:48px;border-radius:16px;background:#ffffff;text-align:center;box-shadow:0 8px 20px rgba(122,62,18,.16);">
    <img src="cid:${MAIL_ICON_CID}" width="42" height="42" alt="" style="display:block;width:42px;height:42px;margin:3px auto 0;border:0;border-radius:12px;object-fit:contain;" />
  </div>`;

export const buildEmailInlineAttachments = () => {
  const iconPath = resolve(process.cwd(), 'public', 'mail', MAIL_ICON_FILENAME);

  if (!existsSync(iconPath)) {
    return [];
  }

  return [
    {
      filename: MAIL_ICON_FILENAME,
      path: iconPath,
      cid: MAIL_ICON_CID,
    },
  ];
};

const actionButton = (label: string, url: string) => `
  <div style="margin:20px 0 4px;">
    <a href="${escapeHtml(url)}" style="display:inline-block;border-radius:999px;background:#ea580c;color:#ffffff;text-decoration:none;font-size:14px;font-weight:900;padding:12px 18px;">${escapeHtml(label)}</a>
  </div>`;

const baseEmail = ({
  preview,
  title,
  subtitle,
  body,
}: {
  preview: string;
  title: string;
  subtitle: string;
  body: string;
}) => `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#fff4ea;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#3f2a1d;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)} ${escapeHtml(APP_SLOGAN)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff4ea;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fffdfb;border:1px solid #f0c49b;border-radius:18px;overflow:hidden;box-shadow:0 16px 38px rgba(122,62,18,.12);">
            <tr>
              <td style="background:#f48b2a;background:linear-gradient(135deg,#f48b2a 0%,#ffad55 100%);padding:24px 26px;color:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="width:62px;vertical-align:top;">${walletIcon}</td>
                    <td style="vertical-align:top;">
                      <div style="font-size:14px;font-weight:900;letter-spacing:.02em;color:#ffffff;">${escapeHtml(APP_NAME)}</div>
                      <div style="display:inline-block;margin-top:7px;border:1px solid rgba(255,255,255,.62);border-radius:999px;padding:6px 11px;background:rgba(255,255,255,.14);font-size:12px;font-weight:800;color:#fffdf7;">${escapeHtml(APP_SLOGAN)}</div>
                    </td>
                  </tr>
                </table>
                <div style="font-size:24px;font-weight:900;line-height:1.28;margin-top:18px;color:#ffffff;">${escapeHtml(title)}</div>
                <div style="font-size:14px;line-height:1.65;margin-top:8px;color:#fff7ed;">${escapeHtml(subtitle)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 26px;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 26px;background:#fff8f1;border-top:1px solid #f4ddc8;color:#7a5a44;font-size:12px;line-height:1.65;">
                <strong style="color:#3f2a1d;">${escapeHtml(APP_SLOGAN)}</strong><br />
                Email này được gửi tự động từ hệ thống ${escapeHtml(APP_NAME)}. Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc đổi mật khẩu tài khoản.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export const buildReportEmailHtml = (input: ReportEmailInput) =>
  baseEmail({
    preview: `Báo cáo ${input.periodLabel}: thu ${input.income}, chi ${input.expense}.`,
    title: `Báo cáo chi tiêu ${input.periodLabel}`,
    subtitle: `Kỳ báo cáo: ${input.rangeLabel}`,
    body: `
      ${paragraph(`Xin chào ${input.recipientName},`)}
      ${paragraph('File Excel báo cáo chi tiêu của bạn đã được đính kèm trong email này. Dưới đây là phần tóm tắt nhanh:')}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -8px 14px;">
        <tr>${statCard('Tổng thu', input.income, '#15803d')}${statCard('Tổng chi', input.expense, '#c2410c')}</tr>
        <tr>${statCard('Chênh lệch thu – chi', input.net, '#a16207')}${statCard('Số giao dịch', String(input.transactionCount), '#3f2a1d')}</tr>
      </table>
      ${paragraph('Danh mục chi nhiều nhất')}
      ${(input.topCategories?.length ? input.topCategories : ['Không có khoản chi trong khoảng đã chọn.']).map(paragraph).join('')}
      ${paragraph('File Excel gồm tổng quan, toàn bộ giao dịch, chi theo danh mục, thu chi theo tháng và số dư ví hiện tại.')}
      ${input.methodology ? paragraph(input.methodology) : ''}
    `,
  });

export const buildNewAccountEmailHtml = (input: NewAccountEmailInput) =>
  baseEmail({
    preview: 'Tài khoản Quản lý chi tiêu của bạn đã được tạo.',
    title: 'Tài khoản của bạn đã sẵn sàng',
    subtitle:
      'Đăng nhập bằng mật khẩu tạm thời và đổi mật khẩu ở lần sử dụng đầu tiên.',
    body: `
      ${paragraph('Tài khoản Quản lý chi tiêu của bạn đã được tạo. Dưới đây là thông tin đăng nhập ban đầu:')}
      ${infoBox('Email', input.email, '#3f2a1d')}
      ${infoBox('Mật khẩu tạm', input.temporaryPassword, '#c2410c')}
      <p style="margin:2px 0 0;font-size:13px;line-height:1.65;color:#7a5a44;">Vì lý do bảo mật, hãy đổi mật khẩu ngay sau khi đăng nhập.</p>
    `,
  });

export const buildResetOtpEmailHtml = (input: ResetOtpEmailInput) =>
  baseEmail({
    preview: `Mã xác nhận đặt lại mật khẩu: ${input.otp}`,
    title: 'Mã xác nhận đặt lại mật khẩu',
    subtitle: `Mã này sẽ hết hạn sau ${input.expiresInMinutes} phút.`,
    body: `
      ${paragraph('Bạn vừa yêu cầu đặt lại mật khẩu. Nhập mã dưới đây để tiếp tục:')}
      <div style="text-align:center;border:1px solid #fed7aa;border-radius:16px;background:#fff7ed;padding:20px;margin:12px 0 16px;">
        <div style="font-size:34px;letter-spacing:.18em;font-weight:900;color:#c2410c;line-height:1.2;">${escapeHtml(input.otp)}</div>
      </div>
      <p style="margin:0;font-size:13px;line-height:1.65;color:#7a5a44;">Không chia sẻ mã này cho người khác.</p>
    `,
  });

export const buildTemporaryPasswordEmailHtml = (
  input: TemporaryPasswordEmailInput,
) =>
  baseEmail({
    preview: 'Mật khẩu tạm thời cho tài khoản Quản lý chi tiêu.',
    title: 'Mật khẩu tạm thời',
    subtitle: 'Vui lòng đổi sang mật khẩu mới ngay sau khi đăng nhập.',
    body: `
      ${paragraph('Mật khẩu tạm được cấp cho tài khoản của bạn. Dùng mật khẩu này để đăng nhập lần đầu hoặc tiếp tục thiết lập tài khoản:')}
      <div style="text-align:center;border:1px solid #fed7aa;border-radius:16px;background:#fff7ed;padding:18px;margin:12px 0 16px;">
        <div style="font-size:24px;letter-spacing:.04em;font-weight:900;color:#c2410c;line-height:1.35;">${escapeHtml(input.temporaryPassword)}</div>
      </div>
      <p style="margin:0;font-size:13px;line-height:1.65;color:#7a5a44;">Sau khi đăng nhập, hệ thống sẽ yêu cầu bạn đổi mật khẩu.</p>
    `,
  });

export const buildNotificationEmailHtml = (input: NotificationEmailInput) =>
  baseEmail({
    preview: input.message,
    title: input.title,
    subtitle: input.subtitle ?? 'Thông báo từ hệ thống Quản lý chi tiêu.',
    body: `
      ${
        input.recipientName ? paragraph(`Xin chào ${input.recipientName},`) : ''
      }
      ${paragraph(input.message)}
      ${
        input.actionLabel && input.actionUrl
          ? actionButton(input.actionLabel, input.actionUrl)
          : ''
      }
    `,
  });
