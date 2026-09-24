import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
const fixture = {
  user: { email: 'owner@example.com', full_name: '<Owner>' },
  period: 'month',
  periodLabel: 'tháng',
  displayCurrency: 'VND',
  range: { start: new Date(2026, 0, 1), end: new Date(2026, 1, 1) },
  summary: { income: 1000, expense: 100, net: 900, transactionCount: 2 },
  wallets: [],
  rows: [
    {
      id: 1,
      date: new Date(2026, 0, 1),
      category: 'Lương',
      type: 'Thu',
      amount: 1000,
      wallet: 'Tiền mặt',
      walletType: 'CASH',
      currency: 'VND',
      note: '',
      tags: [],
    },
    {
      id: 2,
      date: new Date(2026, 0, 2),
      category: '<Ăn uống>',
      type: 'Chi',
      amount: 100,
      wallet: 'Tiền mặt',
      walletType: 'CASH',
      currency: 'VND',
      note: '',
      tags: [],
    },
  ],
};
const env = { ...process.env };
type MailPayload = {
  html: string;
  text: string;
  attachments: Array<{ content: Buffer }>;
};
const sendMail = jest.fn<
  Promise<{ accepted: string[]; rejected: string[] }>,
  [MailPayload]
>();
let service: ReportsService;
beforeEach(() => {
  service = new ReportsService({} as never, {} as never);
  jest
    .spyOn(
      service as unknown as { buildReportData(): Promise<typeof fixture> },
      'buildReportData',
    )
    .mockResolvedValue(fixture);
  (
    nodemailer as unknown as { createTransport: jest.Mock }
  ).createTransport.mockReturnValue({ sendMail });
  sendMail
    .mockReset()
    .mockResolvedValue({ accepted: ['recipient@example.com'], rejected: [] });
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_FROM = 'reports@example.com';
});
afterEach(() => {
  process.env = { ...env };
  jest.restoreAllMocks();
});

it('rejects missing SMTP instead of logging report contents or claiming success', async () => {
  delete process.env.SMTP_HOST;
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(
    service.sendExcelReport(1, 'PREMIUM', 'month', 'recipient@example.com'),
  ).rejects.toThrow('Chưa cấu hình');
  expect(sendMail).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it('sends a five-sheet workbook and escaped summary without claiming inbox delivery', async () => {
  const result = await service.sendExcelReport(
    1,
    'PREMIUM',
    'month',
    'recipient@example.com',
  );
  expect(result.mail).toEqual({
    accepted: true,
    delivered: false,
    devOnly: false,
  });
  const mail = sendMail.mock.calls[0][0] as {
    html: string;
    text: string;
    attachments: Array<{ content: Buffer }>;
  };
  expect(mail.html).toContain('&lt;Ăn uống&gt;');
  expect(mail.html).not.toContain('<Owner>');
  expect(mail.text).toContain('Chênh lệch thu – chi');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(mail.attachments[0].content as never);
  expect(workbook.worksheets).toHaveLength(5);
  expect(workbook.getWorksheet('Giao dich')?.rowCount).toBe(3);
  expect(workbook.getWorksheet('Chi theo danh muc')?.getCell('B2').value).toBe(
    100,
  );
  expect(workbook.getWorksheet('Thu chi theo thang')?.getCell('D2').value).toBe(
    900,
  );
});

it('does not report success if the recipient is rejected', async () => {
  sendMail.mockResolvedValue({
    accepted: [],
    rejected: ['recipient@example.com'],
  });
  await expect(
    service.sendExcelReport(1, 'PREMIUM', 'month', 'recipient@example.com'),
  ).rejects.toThrow('chưa chấp nhận');
});

it('returns a safe uncertain-result message on SMTP failure', async () => {
  sendMail.mockRejectedValue(new Error('smtp credential detail'));
  await expect(
    service.sendExcelReport(1, 'PREMIUM', 'month', 'recipient@example.com'),
  ).rejects.toThrow('kiểm tra hộp thư');
});

it('rejects a malformed recipient before building or sending a report', async () => {
  await expect(
    service.sendExcelReport(
      1,
      'PREMIUM',
      'month',
      'one@example.com,two@example.com',
    ),
  ).rejects.toThrow('chưa hợp lệ');
  expect(sendMail).not.toHaveBeenCalled();
});

it('blocks concurrent sends for the same account without sending a second email', async () => {
  let resolveMail!: (value: { accepted: string[]; rejected: string[] }) => void;
  sendMail.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveMail = resolve;
      }),
  );
  const first = service.sendExcelReport(
    1,
    'PREMIUM',
    'month',
    'recipient@example.com',
  );
  await expect(
    service.sendExcelReport(1, 'PREMIUM', 'month', 'recipient@example.com'),
  ).rejects.toThrow('đang được gửi');
  // Workbook generation is asynchronous; wait until the fake transport is reached.
  while (!resolveMail) await new Promise((resolve) => setTimeout(resolve, 5));
  resolveMail({ accepted: ['recipient@example.com'], rejected: [] });
  await first;
  expect(sendMail).toHaveBeenCalledTimes(1);
});
