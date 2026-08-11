/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { buildBudgetForecast, BudgetsService } from './budgets.service';
import { BudgetPeriod, BudgetScope } from './dto/create-budget.dto';

const joinSql = (strings: TemplateStringsArray | string[]) =>
  Array.from(strings).join(' ');
const getRawSql = (mock: jest.Mock, callIndex: number) => {
  const input = mock.mock.calls[callIndex][0] as
    | TemplateStringsArray
    | { strings?: string[] };
  const strings = Array.isArray(input)
    ? (input as unknown as string[])
    : ((input as { strings?: string[] }).strings ?? []);
  return joinSql(strings);
};

describe('BudgetsService scoped budgets', () => {
  const wallet = { id: 10, name: 'Cash', currency: 'VND' };
  const expenseCategory = {
    id: 22,
    name: 'an uong',
    type: 'EXPENSE',
    cash_flow_group: 'NORMAL',
    icon: null,
    is_system: true,
    user_id: null,
  };

  const makeService = () => {
    const prisma = {
      wallets: {
        findFirst: jest.fn().mockResolvedValue(wallet),
      },
      categories: {
        findFirst: jest.fn().mockResolvedValue(expenseCategory),
      },
      budgets: {
        create: jest.fn().mockResolvedValue({ id: 123 }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $queryRaw: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

    return {
      prisma,
      service: new BudgetsService(prisma),
    };
  };

  it('normalizes a daily budget to one calendar day', () => {
    const { service } = makeService();
    const range = (
      service as unknown as {
        normalizePeriodRange(input: {
          period: BudgetPeriod;
          startDate: string;
        }): { startDate: Date; endDate: Date };
      }
    ).normalizePeriodRange({
      period: BudgetPeriod.DAY,
      startDate: '2026-06-13',
    });

    expect(range).toEqual({
      startDate: new Date(2026, 5, 13, 0, 0, 0, 0),
      endDate: new Date(2026, 5, 13, 23, 59, 59, 0),
    });
  });

  it('moves a daily budget to the following calendar day', () => {
    const { service } = makeService();
    const range = (
      service as unknown as {
        nextPeriodRange(
          period: BudgetPeriod,
          currentEnd: Date,
        ): {
          startDate: Date;
          endDate: Date;
        };
      }
    ).nextPeriodRange(BudgetPeriod.DAY, new Date(2026, 5, 13, 23, 59, 59, 0));

    expect(range).toEqual({
      startDate: new Date(2026, 5, 14, 0, 0, 0, 0),
      endDate: new Date(2026, 5, 14, 23, 59, 59, 0),
    });
  });

  it('treats a period ending at midnight as expired for the current-day filter', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0n }]);

    await service.findAll(1, {
      page: 1,
      limit: 10,
      periodFilter: 'CURRENT',
      currentDate: '2026-06-13',
    });

    expect(getRawSql(prisma.$queryRaw as jest.Mock, 0)).toContain(
      'b.end_date >',
    );
  });

  it('paginates budget rows while preserving metadata', async () => {
    const { prisma, service } = makeService();
    const row = {
      id: 124,
      user_id: 1,
      name: 'Month 5',
      scope: BudgetScope.WALLET,
      wallet_id: wallet.id,
      wallet_name: wallet.name,
      wallet_currency: wallet.currency,
      category_id: null,
      category_name: null,
      limit_amount: new Prisma.Decimal(5000000),
      period: BudgetPeriod.MONTH,
      start_date: new Date('2026-05-01T00:00:00'),
      end_date: new Date('2026-05-31T23:59:59.999'),
      is_active: true,
      deleted_at: null,
      created_at: null,
      updated_at: null,
    };
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ total: 23n }])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(1000000) }])
      .mockResolvedValueOnce([]);

    const result = await service.findAll(1, {
      page: 2,
      limit: 10,
      periodFilter: 'PREVIOUS_MONTH',
      currentDate: '2026-06-12',
    });

    expect(result).toEqual({
      data: [expect.objectContaining({ id: 124, spent: 1000000 })],
      meta: { page: 2, limit: 10, total: 23, totalPages: 3 },
    });
  });

  it('builds a mid-period forecast without changing actual spending', () => {
    expect(
      buildBudgetForecast({
        startDate: new Date('2026-06-01T00:00:00'),
        endDate: new Date('2026-06-30T23:59:59.999'),
        evaluationDate: new Date('2026-06-10T12:00:00'),
        spent: 3000000,
        availableLimit: 6000000,
      }),
    ).toEqual({
      total_days: 30,
      elapsed_days: 10,
      days_remaining: 20,
      daily_average: 300000,
      projected_spent: 9000000,
      recommended_daily: 150000,
    });
  });

  it('returns paginated transactions counted by a wallet budget', async () => {
    const { prisma, service } = makeService();
    const row = {
      id: 124,
      user_id: 1,
      name: 'Month 5',
      scope: BudgetScope.WALLET,
      wallet_id: wallet.id,
      wallet_name: wallet.name,
      wallet_currency: wallet.currency,
      category_id: null,
      category_name: null,
      limit_amount: new Prisma.Decimal(5000000),
      period: BudgetPeriod.MONTH,
      start_date: new Date('2026-05-01T00:00:00'),
      end_date: new Date('2026-05-31T23:59:59.999'),
      is_active: true,
      deleted_at: null,
      created_at: null,
      updated_at: null,
    };
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([
        {
          id: 9,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          category_id: null,
          category_name: null,
          category_icon: null,
          amount: new Prisma.Decimal(-250000),
          currency: 'VND',
          note: 'Chi chưa phân loại',
          transaction_date: new Date('2026-05-12T10:00:00'),
          created_at: new Date('2026-05-12T10:00:00'),
        },
      ])
      .mockResolvedValueOnce([{ total: 1n }]);

    const result = await service.findTransactions(1, 124, 1, 10);

    expect(result).toEqual({
      data: [
        expect.objectContaining({ id: 9, amount: 250000, type: 'EXPENSE' }),
      ],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it('checks duplicate wallet budgets with category_id IS NULL', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ id: 99 }]);

    await expect(
      service.create(1, {
        name: 'Month 5',
        scope: BudgetScope.WALLET,
        wallet_id: wallet.id,
        category_id: null,
        limit_amount: '1000000',
        period: BudgetPeriod.MONTH,
        start_date: '2026-05-01',
        end_date: '2026-05-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const duplicateSql = getRawSql(prisma.$queryRaw as jest.Mock, 0);
    expect(duplicateSql).toContain('scope =');
    expect(duplicateSql).toContain('category_id IS NULL');
    expect(prisma.budgets.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('rejects a budget name containing only whitespace', async () => {
    const { prisma, service } = makeService();

    await expect(
      service.create(1, {
        name: '   ',
        scope: BudgetScope.WALLET,
        wallet_id: wallet.id,
        category_id: null,
        limit_amount: '1000000',
        period: BudgetPeriod.MONTH,
        start_date: '2026-05-01',
        end_date: '2026-05-31',
      }),
    ).rejects.toThrow('Vui lòng nhập tên ngân sách');

    expect(prisma.budgets.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('maps duplicate database races to duplicate budget validation errors', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]);
    (prisma.budgets.create as jest.Mock).mockRejectedValueOnce(
      new PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'budgets_duplicate_unique_idx' },
      }),
    );

    await expect(
      service.create(1, {
        name: 'Month 5',
        scope: BudgetScope.WALLET,
        wallet_id: wallet.id,
        category_id: null,
        limit_amount: '1000000',
        period: BudgetPeriod.MONTH,
        start_date: '2026-05-01',
        end_date: '2026-05-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks duplicate category budgets with category_id equality', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ id: 99 }]);

    await expect(
      service.create(1, {
        name: 'Food',
        scope: BudgetScope.CATEGORY,
        wallet_id: wallet.id,
        category_id: expenseCategory.id,
        limit_amount: '500000',
        period: BudgetPeriod.MONTH,
        start_date: '2026-05-01',
        end_date: '2026-05-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const duplicateSql = getRawSql(prisma.$queryRaw as jest.Mock, 0);
    expect(duplicateSql).toContain('scope =');
    expect(duplicateSql).toContain('category_id =');
    expect(duplicateSql).not.toContain('category_id IS NULL');
    expect(prisma.budgets.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('rejects category budgets for loan and debt cash flow', async () => {
    const { prisma, service } = makeService();
    (prisma.categories.findFirst as jest.Mock).mockResolvedValueOnce({
      ...expenseCategory,
      id: 23,
      name: 'Trả nợ',
      cash_flow_group: 'LOAN_DEBT',
    });

    await expect(
      service.create(1, {
        name: 'Trả nợ tháng này',
        scope: BudgetScope.CATEGORY,
        wallet_id: wallet.id,
        category_id: 23,
        limit_amount: '500000',
        period: BudgetPeriod.MONTH,
        start_date: '2026-05-01',
        end_date: '2026-05-31',
      }),
    ).rejects.toThrow('Không thể lập ngân sách chi tiêu cho danh mục vay/nợ');

    expect(prisma.budgets.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('filters category budget spending by category_id', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 123,
          user_id: 1,
          name: 'Food',
          scope: BudgetScope.CATEGORY,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: expenseCategory.id,
          category_name: expenseCategory.name,
          limit_amount: new Prisma.Decimal(500000),
          period: BudgetPeriod.MONTH,
          start_date: new Date('2026-05-01T00:00:00'),
          end_date: new Date('2026-05-31T23:59:59'),
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(300000) }]);

    const result = await service.findOne(1, 123);

    const spentSql = getRawSql(prisma.$queryRaw as jest.Mock, 1);
    expect(spentSql).toContain('t.amount < 0');
    expect(spentSql).toContain('t.category_id =');
    expect(spentSql).toContain("COALESCE(c.cash_flow_group, '') = 'LOAN_DEBT'");
    expect(result.spent).toBe(300000);
    expect(result.remaining).toBe(200000);
    expect(result.percent).toBe(60);
  });

  it('creates the next fixed period as a new budget record', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 123,
          user_id: 1,
          name: 'Month 5',
          scope: BudgetScope.WALLET,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: null,
          category_name: null,
          limit_amount: new Prisma.Decimal(1000000),
          period: BudgetPeriod.MONTH,
          start_date: new Date('2026-05-01T00:00:00'),
          end_date: new Date('2026-05-31T23:59:59'),
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 124,
          user_id: 1,
          name: 'Month 5',
          scope: BudgetScope.WALLET,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: null,
          category_name: null,
          limit_amount: new Prisma.Decimal(1000000),
          period: BudgetPeriod.MONTH,
          start_date: new Date('2026-06-01T00:00:00'),
          end_date: new Date('2026-06-30T23:59:59'),
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(0) }]);

    const result = await service.createNextPeriod(1, 123);

    expect(prisma.budgets.create as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          start_date: new Date('2026-06-01T00:00:00'),
          end_date: new Date('2026-06-30T23:59:59.000'),
        }),
      }),
    );
    expect(prisma.budgets.update as jest.Mock).not.toHaveBeenCalled();
    expect(result).toEqual({
      creation_state: 'created',
      budget: expect.objectContaining({ id: 124 }),
    });
  });

  it('returns the existing next period instead of reporting a duplicate', async () => {
    const { prisma, service } = makeService();
    const current = {
      id: 123,
      user_id: 1,
      name: 'Month 5',
      scope: BudgetScope.WALLET,
      wallet_id: wallet.id,
      wallet_name: wallet.name,
      wallet_currency: wallet.currency,
      category_id: null,
      category_name: null,
      limit_amount: new Prisma.Decimal(1000000),
      period: BudgetPeriod.MONTH,
      start_date: new Date('2026-05-01T00:00:00'),
      end_date: new Date('2026-05-31T23:59:59.999'),
      is_active: true,
      deleted_at: null,
      created_at: null,
      updated_at: null,
    };
    const existing = {
      ...current,
      id: 124,
      start_date: new Date('2026-06-01T00:00:00'),
      end_date: new Date('2026-06-30T23:59:59.999'),
    };
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([{ id: 124 }])
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(0) }])
      .mockResolvedValueOnce([]);

    const result = await service.createNextPeriod(1, 123);

    expect(prisma.budgets.create as jest.Mock).not.toHaveBeenCalled();
    expect(result).toEqual({
      creation_state: 'existing',
      budget: expect.objectContaining({ id: 124 }),
    });
  });

  it('returns effective budget fields reduced by previous matching overspend', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 124,
          user_id: 1,
          name: 'Month 6',
          scope: BudgetScope.WALLET,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: null,
          category_name: null,
          limit_amount: new Prisma.Decimal(5000000),
          period: BudgetPeriod.MONTH,
          start_date: new Date('2026-06-01T00:00:00'),
          end_date: new Date('2026-06-30T23:59:59.999'),
          is_active: true,
          deleted_at: null,
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(500000) }])
      .mockResolvedValueOnce([
        {
          id: 123,
          user_id: 1,
          name: 'Month 5',
          scope: BudgetScope.WALLET,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: null,
          category_name: null,
          limit_amount: new Prisma.Decimal(5000000),
          period: BudgetPeriod.MONTH,
          start_date: new Date('2026-05-01T00:00:00'),
          end_date: new Date('2026-05-31T23:59:59.999'),
          is_active: true,
          deleted_at: null,
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(5700000) }]);

    const result = await service.findOne(1, 124);

    expect(result.limit_amount).toBe(5000000);
    expect(result.original_limit_amount).toBe(5000000);
    expect(result.carry_over_overspent).toBe(700000);
    expect(result.available_limit_amount).toBe(4300000);
    expect(result.remaining).toBe(4500000);
    expect(result.effective_remaining).toBe(3800000);
    expect(result.effective_percent).toBe(12);
  });

  it('marks a budget exceeded when previous overspend is greater than the new limit', async () => {
    const { prisma, service } = makeService();
    const currentBudget = {
      id: 124,
      user_id: 1,
      name: 'Month 6',
      scope: BudgetScope.WALLET,
      wallet_id: wallet.id,
      wallet_name: wallet.name,
      wallet_currency: wallet.currency,
      category_id: null,
      category_name: null,
      limit_amount: new Prisma.Decimal(1000000),
      period: BudgetPeriod.MONTH,
      start_date: new Date('2026-06-01T00:00:00'),
      end_date: new Date('2026-06-30T23:59:59.999'),
      is_active: true,
      deleted_at: null,
      created_at: null,
      updated_at: null,
    };
    const previousBudget = {
      ...currentBudget,
      id: 123,
      name: 'Month 5',
      start_date: new Date('2026-05-01T00:00:00'),
      end_date: new Date('2026-05-31T23:59:59.999'),
    };
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([currentBudget])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(0) }])
      .mockResolvedValueOnce([previousBudget])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(2200000) }]);

    const result = await service.findOne(1, 124);

    expect(result.carry_over_overspent).toBe(1200000);
    expect(result.available_limit_amount).toBe(0);
    expect(result.effective_remaining).toBe(-200000);
    expect(result.status).toBe('EXCEEDED');
  });

  it('keeps custom budget start and end dates from user input', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 125,
          user_id: 1,
          name: 'Custom event',
          scope: BudgetScope.WALLET,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: null,
          category_name: null,
          limit_amount: new Prisma.Decimal(800000),
          period: BudgetPeriod.CUSTOM,
          start_date: new Date('2026-05-10T00:00:00'),
          end_date: new Date('2026-05-20T23:59:59.000'),
          is_active: true,
          deleted_at: null,
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(0) }]);

    await service.create(1, {
      name: 'Custom event',
      scope: BudgetScope.WALLET,
      wallet_id: wallet.id,
      category_id: null,
      limit_amount: '800000',
      period: BudgetPeriod.CUSTOM,
      start_date: '2026-05-10',
      end_date: '2026-05-20',
    });

    expect(prisma.budgets.create as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          period: BudgetPeriod.CUSTOM,
          start_date: new Date('2026-05-10T00:00:00'),
          end_date: new Date('2026-05-20T23:59:59.000'),
        }),
      }),
    );
  });

  it('normalizes quarter budgets to the current quarter range', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 126,
          user_id: 1,
          name: 'Quarter budget',
          scope: BudgetScope.WALLET,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: null,
          category_name: null,
          limit_amount: new Prisma.Decimal(900000),
          period: BudgetPeriod.QUARTER,
          start_date: new Date('2026-04-01T00:00:00'),
          end_date: new Date('2026-06-30T23:59:59.000'),
          is_active: true,
          deleted_at: null,
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(0) }]);

    await service.create(1, {
      name: 'Quarter budget',
      scope: BudgetScope.WALLET,
      wallet_id: wallet.id,
      category_id: null,
      limit_amount: '900000',
      period: BudgetPeriod.QUARTER,
      start_date: '2026-05-15',
    });

    expect(prisma.budgets.create as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          period: BudgetPeriod.QUARTER,
          start_date: new Date('2026-04-01T00:00:00'),
          end_date: new Date('2026-06-30T23:59:59.000'),
        }),
      }),
    );
  });

  it('soft deletes budgets instead of hard deleting them', async () => {
    const { prisma, service } = makeService();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 123,
          user_id: 1,
          name: 'Month 5',
          scope: BudgetScope.WALLET,
          wallet_id: wallet.id,
          wallet_name: wallet.name,
          wallet_currency: wallet.currency,
          category_id: null,
          category_name: null,
          limit_amount: new Prisma.Decimal(1000000),
          period: BudgetPeriod.MONTH,
          start_date: new Date('2026-05-01T00:00:00'),
          end_date: new Date('2026-05-31T23:59:59'),
          is_active: true,
          deleted_at: null,
          created_at: null,
          updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ spent: new Prisma.Decimal(0) }]);

    await service.remove(1, 123);

    expect(prisma.budgets.update as jest.Mock).toHaveBeenCalledWith({
      where: { id: 123 },
      data: {
        is_active: false,
        deleted_at: expect.any(Date),
      },
    });
    expect(prisma.budgets.delete as jest.Mock).not.toHaveBeenCalled();
  });
});
