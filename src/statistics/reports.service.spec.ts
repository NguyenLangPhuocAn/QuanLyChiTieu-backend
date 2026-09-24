/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prisma } from '@prisma/client';
import { ReportsService } from './reports.service';
import type { StatisticsPeriod } from './statistics.service';

type ReportData = {
  user: {
    email: string;
    full_name: string | null;
  };
  period: StatisticsPeriod;
  range: {
    start: Date;
    end: Date;
  };
  displayCurrency: string;
  summary: {
    income: number;
    expense: number;
    net: number;
    transactionCount: number;
  };
  wallets: unknown[];
  rows: Array<{ category: string }>;
  periodLabel: string;
};

type ReportFile = {
  filename: string;
  mimeType: string;
  base64: string;
};

type MailResult = {
  delivered: boolean;
  devOnly: boolean;
};

type ReportsServiceTestAccess = Pick<ReportsService, 'sendExcelReport'> & {
  buildReportData(
    userId: number,
    role: string | null,
    period: StatisticsPeriod,
  ): Promise<ReportData>;
  exportExcel(data: ReportData): Promise<ReportFile>;
  sendMail(
    to: string,
    subject: string,
    text: string,
    attachment: { filename: string; content: Buffer; contentType: string },
    options?: { html?: string },
  ): Promise<MailResult>;
};

describe('ReportsService', () => {
  const currencyService = {
    normalizeCurrency: jest.fn((currency?: string | null) => currency ?? 'VND'),
    convertAmount: jest.fn((amount: Prisma.Decimal) => ({
      amount: Number(amount),
      currency: 'VND',
    })),
  };

  it('excludes loan/debt categories from report income, expense, and rows', async () => {
    const prisma = {
      users: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'user@example.com',
          full_name: 'User',
          currency_default: 'VND',
        }),
      },
      wallets: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            name: 'Cash',
            wallet_type: 'CASH',
            currency: 'VND',
            balance: new Prisma.Decimal(1000000),
          },
        ]),
      },
      transactions: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            wallet_id: 1,
            category_id: 10,
            amount: new Prisma.Decimal(5000000),
            currency: 'VND',
            converted_amount: null,
            converted_currency: null,
            exchange_rate_used: null,
            note: 'salary',
            transaction_date: new Date('2026-06-01T00:00:00.000Z'),
          },
          {
            id: 2,
            wallet_id: 1,
            category_id: 11,
            amount: new Prisma.Decimal(-1000000),
            currency: 'VND',
            converted_amount: null,
            converted_currency: null,
            exchange_rate_used: null,
            note: 'food',
            transaction_date: new Date('2026-06-02T00:00:00.000Z'),
          },
          {
            id: 3,
            wallet_id: 1,
            category_id: 12,
            amount: new Prisma.Decimal(3000000),
            currency: 'VND',
            converted_amount: null,
            converted_currency: null,
            exchange_rate_used: null,
            note: 'loan received',
            transaction_date: new Date('2026-06-03T00:00:00.000Z'),
          },
          {
            id: 4,
            wallet_id: 1,
            category_id: 13,
            amount: new Prisma.Decimal(-500000),
            currency: 'VND',
            converted_amount: null,
            converted_currency: null,
            exchange_rate_used: null,
            note: 'debt payment',
            transaction_date: new Date('2026-06-04T00:00:00.000Z'),
          },
        ]),
      },
      categories: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            name: 'Salary',
            type: 'INCOME',
            icon: 'categories/icons/income_salary.png',
            cash_flow_group: 'NORMAL',
          },
          {
            id: 11,
            name: 'Food',
            type: 'EXPENSE',
            icon: 'categories/icons/expense_food.png',
            cash_flow_group: 'NORMAL',
          },
          {
            id: 12,
            name: 'Borrowed cash',
            type: 'INCOME',
            icon: 'categories/icons/income_other.png',
            cash_flow_group: 'LOAN_DEBT',
          },
          {
            id: 13,
            name: 'Debt repayment',
            type: 'EXPENSE',
            icon: 'categories/icons/expense_other.png',
            cash_flow_group: 'LOAN_DEBT',
          },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const service = new ReportsService(
      prisma as never,
      currencyService as never,
    );

    const data = await (
      service as unknown as ReportsServiceTestAccess
    ).buildReportData(1, 'PREMIUM', 'month');

    expect(data.summary).toEqual(
      expect.objectContaining({
        income: 5000000,
        expense: 1000000,
        net: 4000000,
        transactionCount: 2,
      }),
    );
    expect(data.rows.map((row: { category: string }) => row.category)).toEqual([
      'Salary',
      'Food',
    ]);
    expect(prisma.categories.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ cash_flow_group: true }),
      }),
    );
  });

  it('sends report email with an HTML body and plain text fallback', async () => {
    const service = new ReportsService(
      {} as never,
      currencyService as never,
    ) as unknown as ReportsServiceTestAccess;
    const data: ReportData = {
      user: {
        email: 'user@example.com',
        full_name: 'User',
      },
      period: 'month',
      range: {
        start: new Date('2026-06-01T00:00:00.000Z'),
        end: new Date('2026-07-01T00:00:00.000Z'),
      },
      displayCurrency: 'VND',
      summary: {
        income: 5000000,
        expense: 1200000,
        net: 3800000,
        transactionCount: 8,
      },
      wallets: [],
      rows: [],
      periodLabel: 'tháng',
    };

    jest.spyOn(service, 'buildReportData').mockResolvedValue(data);
    jest.spyOn(service, 'exportExcel').mockResolvedValue({
      filename: 'bao-cao.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Buffer.from('xlsx').toString('base64'),
    });
    const sendMail = jest
      .spyOn(service, 'sendMail')
      .mockResolvedValue({ delivered: true, devOnly: false });

    await service.sendExcelReport(1, 'PREMIUM', 'month', 'USER@example.com');

    expect(sendMail).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringContaining('tháng'),
      expect.stringContaining('Tổng thu'),
      expect.objectContaining({ filename: 'bao-cao.xlsx' }),
      expect.objectContaining({
        html: expect.stringContaining('<html'),
      }),
    );
    expect(sendMail.mock.calls[0][4]?.html).toContain('Quản tiền rõ ràng');
  });
});
