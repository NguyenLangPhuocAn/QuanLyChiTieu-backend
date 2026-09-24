import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { SavingsService } from './savings.service';

const wallet = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  name: 'Ví chính',
  wallet_type: 'BANK',
  currency: 'VND',
  balance: new Prisma.Decimal(5_000_000),
  is_active: true,
  deleted_at: null,
  created_at: new Date(),
  ...overrides,
});

const makeService = () => {
  const tx = {
    wallets: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    wallet_transfers: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as jest.Mocked<PrismaService>;
  const currency = {
    normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
  } as unknown as CurrencyService;
  return { tx, prisma, service: new SavingsService(prisma, currency) };
};

describe('SavingsService wallet transfers', () => {
  it.each(['0', '-0', '-1', 'NaN', 'Infinity'])(
    'rejects invalid transfer amount %s before touching balances',
    async (amount) => {
      const { service, tx } = makeService();
      await expect(
        service.transferBetweenWallets(7, {
          source_wallet_id: 1,
          destination_wallet_id: 2,
          amount,
        }),
      ).rejects.toThrow('Số tiền chuyển không hợp lệ');
      expect(tx.wallets.updateMany).not.toHaveBeenCalled();
    },
  );
  it('moves balances atomically without creating an income/expense transaction', async () => {
    const { tx, service } = makeService();
    tx.wallets.findFirst
      .mockResolvedValueOnce(wallet({ id: 1 }))
      .mockResolvedValueOnce(
        wallet({ id: 2, name: 'Ví phụ', balance: new Prisma.Decimal(0) }),
      );
    tx.wallets.updateMany.mockResolvedValue({ count: 1 });
    tx.wallets.update.mockResolvedValue(wallet({ id: 2 }));
    tx.wallet_transfers.create.mockResolvedValue({
      id: 9,
      user_id: 7,
      source_wallet_id: 1,
      destination_wallet_id: 2,
      amount: new Prisma.Decimal(500_000),
      currency: 'VND',
      transfer_date: new Date('2026-08-28T00:00:00.000Z'),
      note: null,
      deleted_at: null,
      created_at: new Date(),
    });

    const result = await service.transferBetweenWallets(7, {
      source_wallet_id: 1,
      destination_wallet_id: 2,
      amount: '500000',
      transfer_date: '2026-08-28T00:00:00.000Z',
    });

    expect(tx.wallets.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balance: { decrement: new Prisma.Decimal(500_000) } },
      }),
    );
    expect(tx.wallets.updateMany).toHaveBeenCalledWith({
      where: {
        id: 2,
        user_id: 7,
        currency: 'VND',
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
      },
      data: { balance: { increment: new Prisma.Decimal(500_000) } },
    });
    expect(result.amount).toBe(500000);
    expect((tx as { transactions?: unknown }).transactions).toBeUndefined();
  });

  it('rejects a transfer when the source balance is insufficient', async () => {
    const { tx, service } = makeService();
    tx.wallets.findFirst
      .mockResolvedValueOnce(
        wallet({ id: 1, balance: new Prisma.Decimal(1000) }),
      )
      .mockResolvedValueOnce(wallet({ id: 2 }));
    tx.wallets.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.transferBetweenWallets(7, {
        source_wallet_id: 1,
        destination_wallet_id: 2,
        amount: '500000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.wallet_transfers.create).not.toHaveBeenCalled();
  });

  it('forces savings-wallet movements through the goal endpoints', async () => {
    const { tx, service } = makeService();
    tx.wallets.findFirst
      .mockResolvedValueOnce(wallet({ id: 1 }))
      .mockResolvedValueOnce(wallet({ id: 2, wallet_type: 'SAVINGS' }));

    await expect(
      service.transferBetweenWallets(7, {
        source_wallet_id: 1,
        destination_wallet_id: 2,
        amount: '500000',
      }),
    ).rejects.toThrow(
      'Hãy đóng góp hoặc rút tiền ngay trong mục tiêu tiết kiệm',
    );
    expect(tx.wallets.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow source and destination to be the same wallet', async () => {
    const { service } = makeService();
    await expect(
      service.transferBetweenWallets(7, {
        source_wallet_id: 1,
        destination_wallet_id: 1,
        amount: '1000',
      }),
    ).rejects.toThrow('Ví nguồn và ví nhận phải khác nhau');
  });

  it('rejects a transfer if its destination is archived after the initial read', async () => {
    const { tx, service } = makeService();
    tx.wallets.findFirst
      .mockResolvedValueOnce(wallet({ id: 1 }))
      .mockResolvedValueOnce(wallet({ id: 2 }));
    tx.wallets.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(
      service.transferBetweenWallets(7, {
        source_wallet_id: 1,
        destination_wallet_id: 2,
        amount: '1000',
      }),
    ).rejects.toThrow('Ví nhận không còn hoạt động');
    expect(tx.wallet_transfers.create).not.toHaveBeenCalled();
  });
});

describe('SavingsService goal creation', () => {
  it('creates a VND goal without requiring a source wallet when initial amount is empty', async () => {
    const createdWallet = wallet({
      id: 20,
      name: 'Tiết kiệm - Quỹ khẩn cấp',
      wallet_type: 'SAVINGS',
      balance: new Prisma.Decimal(0),
    });
    const createdGoal = {
      id: 30,
      user_id: 7,
      wallet_id: 20,
      name: 'Quỹ khẩn cấp',
      target_amount: new Prisma.Decimal(30_000_000),
      target_date: null,
      note: null,
      status: 'ACTIVE',
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      wallet: createdWallet,
      entries: [],
    };
    const tx = {
      wallets: { create: jest.fn().mockResolvedValue(createdWallet) },
      savings_goals: { create: jest.fn().mockResolvedValue(createdGoal) },
    };
    const findSourceWallet = jest.fn();
    const prisma = {
      users: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'PREMIUM',
          currency_default: 'VND',
        }),
      },
      wallets: { findFirst: findSourceWallet },
      savings_goals: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(createdGoal),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const currency = {
      normalizeCurrency: jest.fn().mockReturnValue('VND'),
    } as unknown as CurrencyService;
    const service = new SavingsService(prisma, currency);

    const result = await service.createGoal(7, {
      name: 'Quỹ khẩn cấp',
      target_amount: '30000000',
    });

    expect(findSourceWallet).not.toHaveBeenCalled();
    expect(tx.wallets.create).toHaveBeenCalledWith({
      data: {
        user_id: 7,
        name: 'Tiết kiệm - Quỹ khẩn cấp',
        wallet_type: 'SAVINGS',
        currency: 'VND',
        balance: new Prisma.Decimal(0),
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        name: 'Quỹ khẩn cấp',
        wallet_currency: 'VND',
        current_amount: 0,
      }),
    );
  });
});

describe('SavingsService goal deletion', () => {
  it('keeps a goal when money arrived between reading the balance and archiving', async () => {
    const update = jest.fn();
    const archive = jest.fn().mockResolvedValue({ count: 0 });
    const tx = { wallets: { updateMany: archive }, savings_goals: { update } };
    const prisma = {
      savings_goals: {
        findFirst: jest.fn().mockResolvedValue({
          id: 4,
          wallet_id: 9,
          wallet: { balance: new Prisma.Decimal(0) },
        }),
      },
      $transaction: (operation: (client: typeof tx) => Promise<void>) =>
        operation(tx),
    } as unknown as PrismaService;
    const service = new SavingsService(prisma, {} as CurrencyService);
    await expect(service.removeGoal(7, 4)).rejects.toThrow('Số dư đã thay đổi');
    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9, user_id: 7, deleted_at: null, balance: { equals: 0 } },
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('SavingsService goal statistics', () => {
  it('treats contributions and withdrawals as goal progress, not spending', () => {
    const { service } = makeService();
    const result = (
      service as unknown as {
        decorateGoal(goal: unknown): {
          current_amount: number;
          remaining_amount: number;
          progress_percent: number;
          status: string;
        };
      }
    ).decorateGoal({
      id: 4,
      user_id: 7,
      wallet_id: 2,
      wallet: {
        name: 'Tiết kiệm',
        currency: 'VND',
        balance: new Prisma.Decimal(1_500_000),
      },
      name: 'Quỹ dự phòng',
      target_amount: new Prisma.Decimal(2_000_000),
      target_date: null,
      status: 'ACTIVE',
      entries: [
        {
          id: 1,
          type: 'CONTRIBUTION',
          amount: new Prisma.Decimal(2_000_000),
          entry_date: new Date(),
          created_at: new Date(),
        },
        {
          id: 2,
          type: 'WITHDRAWAL',
          amount: new Prisma.Decimal(500_000),
          entry_date: new Date(),
          created_at: new Date(),
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        current_amount: 1_500_000,
        remaining_amount: 500_000,
        progress_percent: 75,
        status: 'ACTIVE',
      }),
    );
  });

  it('keeps an achieved goal completed after money is withdrawn', () => {
    const { service } = makeService();
    const result = (
      service as unknown as {
        decorateGoal(goal: unknown): {
          status: string;
          current_amount: number;
          remaining_amount: number;
          progress_percent: number;
        };
      }
    ).decorateGoal({
      id: 4,
      user_id: 7,
      wallet_id: 2,
      wallet: {
        name: 'Tiết kiệm',
        currency: 'VND',
        balance: new Prisma.Decimal(0),
      },
      name: 'Mua laptop',
      target_amount: new Prisma.Decimal(20_000_000),
      target_date: null,
      status: 'COMPLETED',
      entries: [
        {
          id: 1,
          type: 'CONTRIBUTION',
          amount: new Prisma.Decimal(20_000_000),
          entry_date: new Date(),
          created_at: new Date(),
        },
        {
          id: 2,
          type: 'WITHDRAWAL',
          amount: new Prisma.Decimal(20_000_000),
          entry_date: new Date(),
          created_at: new Date(),
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        current_amount: 0,
        remaining_amount: 0,
        progress_percent: 100,
      }),
    );
  });

  it('rejects more contributions after a goal is completed', async () => {
    const findWallet = jest.fn();
    const prisma = {
      savings_goals: {
        findFirst: jest.fn().mockResolvedValue({
          id: 4,
          user_id: 7,
          wallet_id: 2,
          status: 'COMPLETED',
          wallet: wallet({ id: 2, wallet_type: 'SAVINGS' }),
          entries: [],
        }),
      },
      wallets: { findFirst: findWallet },
    } as unknown as PrismaService;
    const currency = {
      normalizeCurrency: jest.fn().mockReturnValue('VND'),
    } as unknown as CurrencyService;
    const service = new SavingsService(prisma, currency);

    await expect(
      service.contribute(7, 4, {
        source_wallet_id: 1,
        amount: '100000',
      }),
    ).rejects.toThrow('Mục tiêu đã hoàn thành');
    expect(findWallet).not.toHaveBeenCalled();
  });

  it('keeps assistant totals separated by currency', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findAll').mockResolvedValue([
      {
        status: 'ACTIVE',
        wallet_currency: 'VND',
        target_amount: 2_000_000,
        current_amount: 500_000,
        remaining_amount: 1_500_000,
        suggested_monthly: 300_000,
      },
      {
        status: 'ACTIVE',
        wallet_currency: 'USD',
        target_amount: 1_000,
        current_amount: 250,
        remaining_amount: 750,
        suggested_monthly: 100,
      },
    ] as Awaited<ReturnType<SavingsService['findAll']>>);

    const context = await service.getAssistantContext(7);

    expect(context.currency_summaries).toEqual([
      {
        currency: 'VND',
        target_amount: 2_000_000,
        saved_amount: 500_000,
        remaining_amount: 1_500_000,
        suggested_monthly: 300_000,
      },
      {
        currency: 'USD',
        target_amount: 1_000,
        saved_amount: 250,
        remaining_amount: 750,
        suggested_monthly: 100,
      },
    ]);
  });
});
