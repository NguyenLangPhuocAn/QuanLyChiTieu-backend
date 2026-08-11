/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CurrencyService } from '../currency/currency.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StatisticsService } from './statistics.service';

const createPrismaMock = () => ({
  users: {
    findUnique: jest.fn(),
  },
  transactions: {
    findMany: jest.fn(),
  },
  categories: {
    findMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
});

describe('StatisticsService', () => {
  it('loads user wallets without filtering out soft-deleted wallets for historical statistics', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn(),
    };
    const service = new StatisticsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
    );

    prisma.users.findUnique.mockResolvedValue({ currency_default: 'VND' });
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 1, currency: 'VND' },
      { id: 2, currency: 'USD' },
    ]);
    prisma.transactions.findMany.mockResolvedValue([]);
    prisma.categories.findMany.mockResolvedValue([]);

    await service.getUserStatistics(7, 'month');

    const [walletQuery] = prisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
    ];
    expect(String(walletQuery)).not.toContain('COALESCE(is_active');
    expect(prisma.transactions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          wallet_id: { in: [1, 2] },
        }),
      }),
    );
  });

  it('excludes loan and debt categories from default income and expense summaries', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn((amount: Prisma.Decimal) => ({
        amount: Number(amount.abs()),
        toCurrency: 'VND',
        rate: 1,
      })),
    };
    const service = new StatisticsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
    );
    const now = new Date();
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 2);
    const transactions = [
      {
        id: 1,
        wallet_id: 10,
        category_id: 100,
        amount: new Prisma.Decimal(5000000),
        currency: 'VND',
        transaction_date: currentMonthDate,
      },
      {
        id: 2,
        wallet_id: 10,
        category_id: 101,
        amount: new Prisma.Decimal(-1000000),
        currency: 'VND',
        transaction_date: currentMonthDate,
      },
      {
        id: 3,
        wallet_id: 10,
        category_id: 102,
        amount: new Prisma.Decimal(2000000),
        currency: 'VND',
        transaction_date: currentMonthDate,
      },
      {
        id: 4,
        wallet_id: 10,
        category_id: 103,
        amount: new Prisma.Decimal(-700000),
        currency: 'VND',
        transaction_date: currentMonthDate,
      },
    ];

    prisma.users.findUnique.mockResolvedValue({ currency_default: 'VND' });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 10, currency: 'VND' }])
      .mockResolvedValueOnce([]);
    prisma.transactions.findMany
      .mockResolvedValueOnce(transactions)
      .mockResolvedValueOnce(transactions);
    prisma.categories.findMany.mockResolvedValue([
      {
        id: 100,
        name: 'Salary',
        type: 'INCOME',
        icon: 'categories/icons/income_salary.png',
      },
      {
        id: 101,
        name: 'Food',
        type: 'EXPENSE',
        icon: 'categories/icons/expense_food.png',
      },
      {
        id: 102,
        name: 'Loan received',
        type: 'INCOME',
        icon: 'categories/icons/expense_loan.png',
      },
      {
        id: 103,
        name: 'Debt payment',
        type: 'EXPENSE',
        icon: 'categories/icons/expense_debt_payment.png',
      },
    ]);

    const result = await service.getUserStatistics(7, 'month');

    expect(result.summary.income).toBe(5000000);
    expect(result.summary.expense).toBe(1000000);
    expect(result.summary.net).toBe(4000000);
    expect(result.summary.transactionCount).toBe(2);
  });
});
