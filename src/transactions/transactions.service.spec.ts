/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from './transactions.service';
import { TransactionType } from './dto/create-transaction.dto';

const createPrismaMock = () => {
  const tx = {
    $queryRaw: jest.fn(),
    transactions: {
      create: jest.fn(),
      update: jest.fn(),
    },
    wallets: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    transaction_tags: {
      deleteMany: jest.fn(),
    },
  };

  return {
    tx,
    loan_debts: { findFirst: jest.fn().mockResolvedValue(null) },
    loan_debt_payments: { findFirst: jest.fn().mockResolvedValue(null) },
    users: {
      findUnique: jest.fn(),
    },
    categories: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    transactions: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    wallets: {
      update: jest.fn(),
    },
    transaction_tags: {
      deleteMany: jest.fn(),
    },
    tags: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
};

describe('TransactionsService', () => {
  it.each(['opening', 'payment'] as const)(
    'blocks deleting a loan %s transaction from the regular ledger',
    async (kind) => {
      const prisma = createPrismaMock();
      prisma.transactions.findUnique.mockResolvedValue({
        id: 10,
        wallet_id: 2,
        amount: new Prisma.Decimal(100),
      });
      prisma.$queryRaw.mockResolvedValue([
        { id: 2, user_id: 7, currency: 'VND' },
      ]);
      (kind === 'opening'
        ? prisma.loan_debts
        : prisma.loan_debt_payments
      ).findFirst.mockResolvedValue({ id: 4 });
      const service = new TransactionsService(
        prisma as unknown as PrismaService,
        {} as CurrencyService,
        {} as NotificationsService,
      );
      await expect(service.remove(7, 10)).rejects.toThrow('mục Vay và nợ');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects a save when the wallet currency or active state changed during processing', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      { id: 2, user_id: 7, currency: 'USD' },
    ]);
    prisma.users.findUnique.mockResolvedValue({ currency_default: 'VND' });
    prisma.tx.transactions.create.mockResolvedValue({ id: 10 });
    prisma.tx.wallets.updateMany.mockResolvedValue({ count: 0 });
    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      {
        normalizeCurrency: (value: string) => value,
        convertAmount: jest.fn().mockResolvedValue({
          amount: 250000,
          rate: 25000,
          toCurrency: 'VND',
        }),
      } as unknown as CurrencyService,
      {} as NotificationsService,
    );
    await expect(
      service.create(7, {
        wallet_id: 2,
        amount: '10',
        type: TransactionType.INCOME,
      }),
    ).rejects.toThrow('Ví vừa thay đổi');
    expect(prisma.tx.wallets.updateMany).toHaveBeenCalledWith({
      where: {
        id: 2,
        user_id: 7,
        currency: 'USD',
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
      },
      data: { balance: { increment: new Prisma.Decimal(10) } },
    });
  });
  it('does not reverse an old amount if a transaction changed before deletion acquired its lock', async () => {
    const prisma = createPrismaMock();
    const old = {
      id: 10,
      wallet_id: 2,
      category_id: 3,
      amount: new Prisma.Decimal(-100),
    };
    prisma.transactions.findUnique.mockResolvedValue(old);
    prisma.$queryRaw.mockResolvedValue([
      { id: 2, user_id: 7, currency: 'VND' },
    ]);
    prisma.tx.$queryRaw.mockResolvedValue([
      { ...old, amount: new Prisma.Decimal(-200) },
    ]);
    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      {} as CurrencyService,
      {} as NotificationsService,
    );
    await expect(service.remove(7, 10)).rejects.toThrow(
      'Giao dịch vừa được thay đổi',
    );
    expect(prisma.tx.wallets.updateMany).not.toHaveBeenCalled();
    expect(prisma.tx.transaction_tags.deleteMany).not.toHaveBeenCalled();
  });

  it('does not change balances if another request already deleted the transaction', async () => {
    const prisma = createPrismaMock();
    prisma.transactions.findUnique.mockResolvedValue({
      id: 10,
      wallet_id: 2,
      category_id: 3,
      amount: new Prisma.Decimal(-100),
    });
    prisma.$queryRaw.mockResolvedValue([
      { id: 2, user_id: 7, currency: 'VND' },
    ]);
    prisma.tx.$queryRaw.mockResolvedValue([]);
    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      {} as CurrencyService,
      {} as NotificationsService,
    );
    await expect(service.remove(7, 10)).rejects.toThrow('Giao dịch đã bị xóa');
    expect(prisma.tx.wallets.updateMany).not.toHaveBeenCalled();
  });
  it('combines both note fields with the loan filter instead of dropping a condition', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([{ id: 3, currency: 'VND' }]);
    prisma.categories.findMany.mockResolvedValue([{ id: 8 }]);
    prisma.transactions.findMany.mockResolvedValue([]);
    prisma.users.findUnique.mockResolvedValue({ currency_default: 'VND' });
    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      { normalizeCurrency: (value: string) => value } as CurrencyService,
      {} as NotificationsService,
    );
    await service.findAll(7, {
      cashFlow: 'loan_debt',
      q: ' học phí ',
      note: 'tháng 9',
    });
    expect(prisma.transactions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          wallet_id: { in: [3] },
          AND: [
            { category_id: { in: [8] } },
            { note: { contains: 'học phí' } },
            { note: { contains: 'tháng 9' } },
          ],
        }),
      }),
    );
  });
  it.each([false, true])(
    'stores the original currency and conversion snapshot even if notification fails (%s)',
    async (notificationFails) => {
      const prisma = createPrismaMock();
      const currencyService = {
        normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
        convertAmount: jest.fn().mockResolvedValue({
          amount: 254000,
          rate: 25400,
          fromCurrency: 'USD',
          toCurrency: 'VND',
        }),
      };
      const notificationsService = {
        createBudgetAlertsForWallet: jest.fn(),
      };
      if (notificationFails)
        notificationsService.createBudgetAlertsForWallet.mockRejectedValue(
          new Error('notification unavailable'),
        );
      const createdTransaction = {
        id: 10,
        wallet_id: 2,
        category_id: 3,
        amount: new Prisma.Decimal(-10),
        note: 'Coffee',
        receipt_image: null,
        transaction_date: new Date('2026-05-23T00:00:00.000Z'),
        created_at: new Date('2026-05-23T01:00:00.000Z'),
        currency: 'USD',
        converted_amount: new Prisma.Decimal(254000),
        converted_currency: 'VND',
        exchange_rate_used: new Prisma.Decimal(25400),
      };

      prisma.$queryRaw.mockResolvedValue([
        { id: 2, user_id: 7, currency: 'USD' },
      ]);
      prisma.users.findUnique
        .mockResolvedValueOnce({ role: 'BASIC' })
        .mockResolvedValueOnce({ currency_default: 'VND' })
        .mockResolvedValueOnce({ currency_default: 'VND' });
      prisma.categories.findFirst.mockResolvedValue({
        id: 3,
        name: 'Food',
        type: 'EXPENSE',
        icon: null,
      });
      prisma.categories.findMany.mockResolvedValue([
        { id: 3, name: 'Food', type: 'EXPENSE', icon: null },
      ]);
      prisma.tx.transactions.create.mockResolvedValue(createdTransaction);

      const service = new TransactionsService(
        prisma as unknown as PrismaService,
        currencyService as unknown as CurrencyService,
        notificationsService as unknown as NotificationsService,
      );

      await service.create(7, {
        wallet_id: 2,
        category_id: 3,
        amount: '10',
        note: 'Coffee',
        receipt_items: [
          { name: 'Coffee', amount: 7 },
          { name: 'Tax', amount: 2 },
        ],
        transaction_date: '2026-05-23',
      });

      expect(prisma.tx.transactions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: new Prisma.Decimal(-10),
          currency: 'USD',
          converted_amount: new Prisma.Decimal(254000),
          converted_currency: 'VND',
          exchange_rate_used: new Prisma.Decimal(25400),
          receipt_items: [
            { name: 'Coffee', amount: 7 },
            { name: 'Tax', amount: 2 },
          ],
        }),
        select: expect.any(Object),
      });
      expect(prisma.tx.wallets.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 2, user_id: 7, deleted_at: null }),
        data: { balance: { increment: new Prisma.Decimal(-10) } },
      });
    },
  );

  it('does not recompute conversion snapshot when only updating the note', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn(),
    };
    const notificationsService = {
      createBudgetAlertsForWallet: jest.fn(),
    };
    const currentTransaction = {
      id: 10,
      wallet_id: 2,
      category_id: 3,
      amount: new Prisma.Decimal(-10),
      note: 'Coffee',
      receipt_image: null,
      transaction_date: new Date('2026-05-23T00:00:00.000Z'),
      created_at: new Date('2026-05-23T01:00:00.000Z'),
      currency: 'USD',
      converted_amount: new Prisma.Decimal(254000),
      converted_currency: 'VND',
      exchange_rate_used: new Prisma.Decimal(25400),
    };
    const updatedTransaction = {
      ...currentTransaction,
      note: 'Coffee with friend',
    };

    prisma.transactions.findUnique.mockResolvedValue(currentTransaction);
    prisma.tx.$queryRaw.mockResolvedValue([currentTransaction]);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 2, user_id: 7, currency: 'USD' }])
      .mockResolvedValueOnce([{ id: 2, user_id: 7, currency: 'USD' }])
      .mockResolvedValueOnce([]);
    prisma.users.findUnique
      .mockResolvedValueOnce({ role: 'BASIC' })
      .mockResolvedValueOnce({ currency_default: 'VND' });
    prisma.categories.findFirst.mockResolvedValue({
      id: 3,
      name: 'Food',
      type: 'EXPENSE',
      icon: null,
    });
    prisma.categories.findMany.mockResolvedValue([
      { id: 3, name: 'Food', type: 'EXPENSE', icon: null },
    ]);
    prisma.tx.transactions.update.mockResolvedValue(updatedTransaction);

    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
      notificationsService as unknown as NotificationsService,
    );

    await service.update(7, 10, { note: 'Coffee with friend' });

    expect(currencyService.convertAmount).not.toHaveBeenCalled();
    expect(prisma.tx.transactions.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        note: 'Coffee with friend',
        currency: undefined,
        converted_amount: undefined,
        converted_currency: undefined,
        exchange_rate_used: undefined,
      }),
      select: expect.any(Object),
    });
  });

  it('updates wallet balance correctly when changing an expense to income', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn().mockResolvedValue({
        amount: 500,
        rate: 1,
        fromCurrency: 'VND',
        toCurrency: 'VND',
      }),
    };
    const notificationsService = {
      createBudgetAlertsForWallet: jest.fn(),
    };
    const currentTransaction = {
      id: 10,
      wallet_id: 2,
      category_id: 3,
      amount: new Prisma.Decimal(-500),
      note: 'Wrong category',
      receipt_image: null,
      transaction_date: new Date('2026-05-23T00:00:00.000Z'),
      created_at: new Date('2026-05-23T01:00:00.000Z'),
      currency: 'VND',
      converted_amount: new Prisma.Decimal(-500),
      converted_currency: 'VND',
      exchange_rate_used: new Prisma.Decimal(1),
    };
    const updatedTransaction = {
      ...currentTransaction,
      category_id: 4,
      amount: new Prisma.Decimal(500),
      converted_amount: new Prisma.Decimal(500),
    };

    prisma.transactions.findUnique.mockResolvedValue(currentTransaction);
    prisma.tx.$queryRaw.mockResolvedValue([currentTransaction]);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 2, user_id: 7, currency: 'VND' }])
      .mockResolvedValueOnce([{ id: 2, user_id: 7, currency: 'VND' }])
      .mockResolvedValueOnce([]);
    prisma.users.findUnique
      .mockResolvedValueOnce({ role: 'BASIC' })
      .mockResolvedValueOnce({ currency_default: 'VND' });
    prisma.categories.findFirst.mockResolvedValue({
      id: 4,
      name: 'Salary',
      type: 'INCOME',
      icon: null,
    });
    prisma.categories.findMany.mockResolvedValue([
      { id: 4, name: 'Salary', type: 'INCOME', icon: null },
    ]);
    prisma.tx.transactions.update.mockResolvedValue(updatedTransaction);

    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
      notificationsService as unknown as NotificationsService,
    );

    await service.update(7, 10, {
      category_id: 4,
      type: TransactionType.INCOME,
    });

    expect(prisma.tx.wallets.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 2, user_id: 7, deleted_at: null }),
      data: {
        balance: {
          increment: new Prisma.Decimal(1000),
        },
      },
    });
    expect(prisma.tx.transactions.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        category_id: 4,
        amount: new Prisma.Decimal(500),
        currency: 'VND',
        converted_amount: new Prisma.Decimal(500),
        converted_currency: 'VND',
        exchange_rate_used: new Prisma.Decimal(1),
      }),
      select: expect.any(Object),
    });
    expect(
      notificationsService.createBudgetAlertsForWallet,
    ).toHaveBeenCalledWith(7, 2);
  });

  it('summarizes paginated transactions in the user display currency', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) =>
        (value ?? 'VND').toUpperCase(),
      ),
      convertAmount: jest.fn(),
    };
    const notificationsService = {
      createBudgetAlertsForWallet: jest.fn(),
    };
    const usdExpense = {
      id: 10,
      wallet_id: 2,
      category_id: null,
      amount: new Prisma.Decimal(-10),
      currency: 'USD',
      converted_amount: new Prisma.Decimal(254000),
      converted_currency: 'VND',
      exchange_rate_used: new Prisma.Decimal(25400),
      note: 'Coffee',
      receipt_image: null,
      transaction_date: new Date('2026-05-23T00:00:00.000Z'),
      created_at: new Date('2026-05-23T01:00:00.000Z'),
    };
    const vndIncome = {
      id: 11,
      wallet_id: 3,
      category_id: null,
      amount: new Prisma.Decimal(5000000),
      currency: 'VND',
      converted_amount: new Prisma.Decimal(5000000),
      converted_currency: 'VND',
      exchange_rate_used: new Prisma.Decimal(1),
      note: 'Salary',
      receipt_image: null,
      transaction_date: new Date('2026-05-24T00:00:00.000Z'),
      created_at: new Date('2026-05-24T01:00:00.000Z'),
    };

    prisma.$queryRaw
      .mockResolvedValueOnce([
        { id: 2, currency: 'USD' },
        { id: 3, currency: 'VND' },
      ])
      .mockResolvedValueOnce([]);
    prisma.transactions.findMany
      .mockResolvedValueOnce([usdExpense])
      .mockResolvedValueOnce([usdExpense, vndIncome]);
    prisma.transactions.count.mockResolvedValue(2);
    prisma.transactions.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal(4999990) },
    });
    prisma.users.findUnique
      .mockResolvedValueOnce({ currency_default: 'VND' })
      .mockResolvedValueOnce({ currency_default: 'VND' });
    prisma.categories.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
      notificationsService as unknown as NotificationsService,
    );

    const result = await service.findAll(7, { page: 1, limit: 1 });

    expect(result).toMatchObject({
      meta: {
        total: 2,
        income: 5000000,
        expense: 254000,
        net: 4746000,
      },
    });
    expect(currencyService.convertAmount).not.toHaveBeenCalled();
  });

  it('filters paginated results to normal cash flow when requested', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn(),
    };
    const notificationsService = {
      createBudgetAlertsForWallet: jest.fn(),
    };

    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 3, currency: 'VND' }])
      .mockResolvedValueOnce([]);
    prisma.transactions.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.transactions.count.mockResolvedValue(0);
    prisma.users.findUnique
      .mockResolvedValueOnce({ currency_default: 'VND' })
      .mockResolvedValueOnce({ currency_default: 'VND' });
    prisma.categories.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const service = new TransactionsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
      notificationsService as unknown as NotificationsService,
    );

    await service.findAll(7, { page: 1, limit: 10, cashFlow: 'normal' });

    const expectedNormalCashFlowFilter = [
      { category_id: null },
      { category_id: { in: [1, 2] } },
    ];
    expect(prisma.transactions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expectedNormalCashFlowFilter,
        }),
      }),
    );
    expect(prisma.transactions.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expectedNormalCashFlowFilter,
        }),
      }),
    );
  });
});
