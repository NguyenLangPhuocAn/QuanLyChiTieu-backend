/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from './wallets.service';

const createPrismaMock = () => {
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    categories: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    transactions: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    wallet_transfers: { count: jest.fn().mockResolvedValue(0) },
    wallets: {
      update: jest.fn(),
    },
  };

  return {
    tx,
    users: {
      findUnique: jest.fn(),
    },
    wallets: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    transactions: {
      count: jest.fn(),
    },
    budgets: {
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
};

describe('WalletsService', () => {
  it.each(['balance', 'transfer', 'archived'] as const)(
    'rejects a wallet update when %s makes the requested change unsafe',
    async (scenario) => {
      const prisma = createPrismaMock();
      const service = new WalletsService(
        prisma as unknown as PrismaService,
        { normalizeCurrency: (value: string) => value } as CurrencyService,
      );
      const wallet = {
        id: 3,
        user_id: 7,
        name: 'Ví',
        wallet_type: 'CASH',
        currency: 'VND',
        balance: new Prisma.Decimal(10),
        is_active: true,
        deleted_at: null,
      };
      prisma.$queryRaw.mockResolvedValue([wallet]);
      prisma.users.findUnique.mockResolvedValue({
        id: 7,
        currency_default: 'VND',
      });
      prisma.tx.$queryRaw.mockResolvedValue([
        {
          ...wallet,
          balance: new Prisma.Decimal(scenario === 'balance' ? 15 : 10),
          is_active: scenario !== 'archived',
        },
      ]);
      prisma.tx.wallet_transfers.count.mockResolvedValue(
        scenario === 'transfer' ? 1 : 0,
      );
      await expect(
        service.update(
          7,
          3,
          scenario === 'transfer' ? { currency: 'USD' } : { balance: '20' },
        ),
      ).rejects.toThrow(
        scenario === 'balance'
          ? 'vừa thay đổi'
          : scenario === 'transfer'
            ? 'chuyển tiền'
            : 'Không tìm thấy ví',
      );
      expect(prisma.tx.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.tx.transactions.create).not.toHaveBeenCalled();
    },
  );

  it('does not expose goal-managed savings wallets in the regular wallet list', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn(),
    };
    const service = new WalletsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
    );

    prisma.users.findUnique.mockResolvedValue({
      id: 7,
      role: 'PREMIUM',
      currency_default: 'VND',
    });
    prisma.$queryRaw.mockResolvedValue([]);

    await service.findAll(7);

    const queryCalls = prisma.$queryRaw.mock.calls as unknown[][];
    const queryParts = queryCalls[0]?.[0] as string[];
    expect(queryParts.join('')).toContain("wallet_type <> 'SAVINGS'");
  });

  it('stores a currency snapshot for balance adjustment transactions', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn().mockResolvedValue({
        amount: 250000,
        rate: 25000,
        fromCurrency: 'USD',
        toCurrency: 'VND',
      }),
    };
    const service = new WalletsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
    );
    const existingWallet = {
      id: 3,
      user_id: 7,
      name: 'USD wallet',
      wallet_type: 'BANK',
      currency: 'USD',
      balance: new Prisma.Decimal(10),
      is_active: true,
      deleted_at: null,
      created_at: new Date('2026-05-24T00:00:00.000Z'),
    };
    const updatedWallet = {
      ...existingWallet,
      balance: new Prisma.Decimal(20),
    };

    prisma.$queryRaw
      .mockResolvedValueOnce([existingWallet])
      .mockResolvedValueOnce([updatedWallet]);
    prisma.users.findUnique.mockResolvedValue({
      id: 7,
      role: 'PREMIUM',
      currency_default: 'VND',
    });
    prisma.tx.categories.findFirst.mockResolvedValue({ id: 9 });
    prisma.tx.$queryRaw.mockResolvedValue([existingWallet]);

    await service.update(7, 3, { balance: '20' });

    expect(prisma.tx.transactions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wallet_id: 3,
        category_id: 9,
        amount: new Prisma.Decimal(10),
        currency: 'USD',
        converted_amount: new Prisma.Decimal(250000),
        converted_currency: 'VND',
        exchange_rate_used: new Prisma.Decimal(25000),
      }),
    });
    expect(currencyService.convertAmount).toHaveBeenCalledWith(
      new Prisma.Decimal(10),
      'USD',
      'VND',
    );
  });

  it('soft deletes a wallet that already has transactions without deleting related data', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn(),
    };
    const service = new WalletsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
    );

    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 3,
        user_id: 7,
        name: 'Main wallet',
        wallet_type: 'CASH',
        currency: 'VND',
        balance: new Prisma.Decimal(100000),
        is_active: true,
        deleted_at: null,
        created_at: new Date('2026-05-24T00:00:00.000Z'),
      },
    ]);
    await service.remove(7, 3);

    expect(prisma.transactions.count).not.toHaveBeenCalled();
    expect(prisma.budgets.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('soft deletes an empty wallet without deleting related data', async () => {
    const prisma = createPrismaMock();
    const currencyService = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn(),
    };
    const service = new WalletsService(
      prisma as unknown as PrismaService,
      currencyService as unknown as CurrencyService,
    );

    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 3,
        user_id: 7,
        name: 'Empty wallet',
        wallet_type: 'CASH',
        currency: 'VND',
        balance: new Prisma.Decimal(0),
        is_active: true,
        deleted_at: null,
        created_at: new Date('2026-05-24T00:00:00.000Z'),
      },
    ]);
    await service.remove(7, 3);

    expect(prisma.transactions.count).not.toHaveBeenCalled();
    expect(prisma.budgets.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.tx.transactions.create).not.toHaveBeenCalled();
  });
});
