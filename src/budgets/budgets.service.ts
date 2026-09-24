import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, categories_type } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { isNormalCashFlow } from '../common/finance/cash-flow-classification';
import { PrismaService } from '../prisma/prisma.service';
import {
  BudgetPeriod,
  BudgetScope,
  CreateBudgetDto,
} from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

type BudgetRow = {
  id: number;
  user_id: number;
  name: string;
  scope: BudgetScope;
  wallet_id: number;
  wallet_name: string;
  wallet_currency: string;
  category_id: number | null;
  category_name: string | null;
  limit_amount: Prisma.Decimal;
  period: BudgetPeriod;
  start_date: Date;
  end_date: Date;
  is_active: boolean | number | null;
  deleted_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
};

type BudgetTransactionRow = {
  id: number;
  wallet_id: number;
  wallet_name: string;
  category_id: number | null;
  category_name: string | null;
  category_icon: string | null;
  amount: Prisma.Decimal;
  currency: string;
  note: string | null;
  transaction_date: Date;
  created_at: Date | null;
};

type BudgetStatus = 'NORMAL' | 'WARNING' | 'EXCEEDED';
type BudgetRangeInput = {
  period: BudgetPeriod;
  startDate?: string;
  endDate?: string;
  fallbackStart?: Date;
  fallbackEnd?: Date;
};

export type BudgetPeriodFilter =
  | 'CURRENT'
  | 'PREVIOUS_MONTH'
  | 'PREVIOUS_QUARTER'
  | 'PREVIOUS_YEAR'
  | 'CUSTOM_RANGE'
  | 'ALL';

export type BudgetListQuery = {
  walletId?: number;
  scope?: BudgetScope;
  query?: string;
  periodFilter?: BudgetPeriodFilter;
  customStartDate?: string;
  customEndDate?: string;
  currentDate?: string;
  page?: number;
  limit?: number;
};

export const buildBudgetForecast = (input: {
  startDate: Date;
  endDate: Date;
  evaluationDate: Date;
  spent: number;
  availableLimit: number;
}) => {
  const dayNumber = (date: Date) =>
    Math.floor(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
    );
  const startDay = dayNumber(input.startDate);
  const endDay = dayNumber(input.endDate);
  const evaluationDay = Math.min(
    endDay,
    Math.max(startDay, dayNumber(input.evaluationDate)),
  );
  const totalDays = Math.max(1, endDay - startDay + 1);
  const elapsedDays = Math.max(1, evaluationDay - startDay + 1);
  const daysRemaining = Math.max(0, totalDays - elapsedDays);
  const roundMoney = (value: number) => Math.round(value * 100) / 100;
  const dailyAverage = roundMoney(input.spent / elapsedDays);

  return {
    total_days: totalDays,
    elapsed_days: elapsedDays,
    days_remaining: daysRemaining,
    daily_average: dailyAverage,
    projected_spent: roundMoney(dailyAverage * totalDays),
    recommended_daily:
      daysRemaining > 0
        ? roundMoney(
            Math.max(input.availableLimit - input.spent, 0) / daysRemaining,
          )
        : 0,
  };
};

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  private isDuplicateBudgetWriteError(error: unknown) {
    if (!(error instanceof PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;
    if (!target) {
      return true;
    }

    if (typeof target === 'string') {
      return target.includes('budgets_duplicate');
    }

    if (Array.isArray(target)) {
      return target.some(
        (item) =>
          typeof item === 'string' && item.includes('budgets_duplicate'),
      );
    }

    return false;
  }

  private throwDuplicateBudget() {
    throw new BadRequestException('Ngân sách đã tồn tại trong kỳ đã chọn');
  }

  private toPositiveDecimal(value: string) {
    try {
      const decimal = new Prisma.Decimal(value);

      if (decimal.lessThanOrEqualTo(0)) {
        throw new Error();
      }

      return decimal;
    } catch {
      throw new BadRequestException('Ngân sách phải lớn hơn 0');
    }
  }

  private normalizeBudgetName(value: string) {
    const name = value.trim();

    if (!name) {
      throw new BadRequestException('Vui lòng nhập tên ngân sách');
    }

    return name;
  }

  private parseDate(value: string, endOfDay = false) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

    if (!match) {
      throw new BadRequestException('Ngày ngân sách không hợp lệ');
    }

    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      0,
    );

    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      throw new BadRequestException('Ngày ngân sách không hợp lệ');
    }

    return date;
  }

  private startOfDay(date: Date) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0,
    );
  }

  private endOfDay(date: Date) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59,
      0,
    );
  }

  private getListRange(query: BudgetListQuery) {
    const period = query.periodFilter ?? 'ALL';
    if (period === 'ALL') {
      return null;
    }

    const anchor = query.currentDate
      ? this.parseDate(query.currentDate)
      : this.startOfDay(new Date());

    if (period === 'CURRENT') {
      return {
        startDate: this.startOfDay(anchor),
        endDate: this.endOfDay(anchor),
      };
    }

    if (period === 'CUSTOM_RANGE') {
      if (!query.customStartDate || !query.customEndDate) {
        throw new BadRequestException(
          'Vui lòng chọn khoảng thời gian ngân sách',
        );
      }

      const startDate = this.parseDate(query.customStartDate);
      const endDate = this.parseDate(query.customEndDate, true);
      if (startDate > endDate) {
        throw new BadRequestException('Ngày bắt đầu phải trước ngày kết thúc');
      }
      return { startDate, endDate };
    }

    if (period === 'PREVIOUS_YEAR') {
      const year = anchor.getFullYear() - 1;
      return {
        startDate: new Date(year, 0, 1),
        endDate: new Date(year, 11, 31, 23, 59, 59, 0),
      };
    }

    if (period === 'PREVIOUS_QUARTER') {
      const startMonth = Math.floor(anchor.getMonth() / 3) * 3 - 3;
      const startDate = new Date(anchor.getFullYear(), startMonth, 1);
      return {
        startDate,
        endDate: new Date(
          startDate.getFullYear(),
          startDate.getMonth() + 3,
          0,
          23,
          59,
          59,
          0,
        ),
      };
    }

    return {
      startDate: new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1),
      endDate: new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        0,
        23,
        59,
        59,
        0,
      ),
    };
  }

  private normalizePeriodRange(input: BudgetRangeInput) {
    const anchor = input.startDate
      ? this.parseDate(input.startDate)
      : input.fallbackStart
        ? this.startOfDay(input.fallbackStart)
        : this.startOfDay(new Date());

    if (input.period === BudgetPeriod.CUSTOM) {
      if (!input.startDate && !input.fallbackStart) {
        throw new BadRequestException('Vui lòng chọn ngày bắt đầu ngân sách');
      }

      if (!input.endDate && !input.fallbackEnd) {
        throw new BadRequestException('Vui lòng chọn ngày kết thúc ngân sách');
      }

      const endDate = input.endDate
        ? this.parseDate(input.endDate, true)
        : this.endOfDay(input.fallbackEnd as Date);

      if (anchor > endDate) {
        throw new BadRequestException(
          'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
        );
      }

      return { startDate: anchor, endDate };
    }

    if (input.period === BudgetPeriod.DAY) {
      return {
        startDate: this.startOfDay(anchor),
        endDate: this.endOfDay(anchor),
      };
    }

    if (input.period === BudgetPeriod.WEEK) {
      const day = anchor.getDay() || 7;
      const startDate = new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() - day + 1,
        0,
        0,
        0,
        0,
      );
      const endDate = this.endOfDay(
        new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          startDate.getDate() + 6,
        ),
      );

      return { startDate, endDate };
    }

    if (input.period === BudgetPeriod.YEAR) {
      return {
        startDate: new Date(anchor.getFullYear(), 0, 1, 0, 0, 0, 0),
        endDate: new Date(anchor.getFullYear(), 11, 31, 23, 59, 59, 0),
      };
    }

    if (input.period === BudgetPeriod.QUARTER) {
      const quarterStartMonth = Math.floor(anchor.getMonth() / 3) * 3;

      return {
        startDate: new Date(
          anchor.getFullYear(),
          quarterStartMonth,
          1,
          0,
          0,
          0,
          0,
        ),
        endDate: new Date(
          anchor.getFullYear(),
          quarterStartMonth + 3,
          0,
          23,
          59,
          59,
          0,
        ),
      };
    }

    return {
      startDate: new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        1,
        0,
        0,
        0,
        0,
      ),
      endDate: new Date(
        anchor.getFullYear(),
        anchor.getMonth() + 1,
        0,
        23,
        59,
        59,
        0,
      ),
    };
  }

  private nextPeriodRange(period: BudgetPeriod, currentEnd: Date) {
    const anchor = new Date(
      currentEnd.getFullYear(),
      currentEnd.getMonth(),
      currentEnd.getDate() + 1,
      0,
      0,
      0,
      0,
    );

    return this.normalizePeriodRange({
      period,
      startDate: `${anchor.getFullYear()}-${`${anchor.getMonth() + 1}`.padStart(2, '0')}-${`${anchor.getDate()}`.padStart(2, '0')}`,
    });
  }

  private async getOwnedWallet(userId: number, walletId: number) {
    const wallet = await this.prisma.wallets.findFirst({
      where: {
        id: walletId,
        user_id: userId,
        OR: [{ is_active: true }, { is_active: null }],
      },
      select: {
        id: true,
        name: true,
        currency: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    return wallet;
  }

  private async getExpenseCategory(userId: number, categoryId: number) {
    const category = await this.prisma.categories.findFirst({
      where: {
        id: categoryId,
        type: categories_type.EXPENSE,
        AND: [
          { OR: [{ is_active: true }, { is_active: null }] },
          { OR: [{ is_system: true }, { user_id: userId }] },
        ],
      },
      select: {
        id: true,
        name: true,
        type: true,
        icon: true,
        cash_flow_group: true,
      },
    });

    if (!category) {
      throw new BadRequestException(
        'Danh mục ngân sách phải là danh mục chi tiêu',
      );
    }

    if (!isNormalCashFlow(category)) {
      throw new BadRequestException(
        'Không thể lập ngân sách chi tiêu cho danh mục vay/nợ hoặc tiết kiệm',
      );
    }

    return category;
  }

  private normalizeScopeInput(scope: BudgetScope, categoryId?: number | null) {
    if (scope === BudgetScope.WALLET) {
      return { scope, categoryId: null };
    }

    if (!categoryId) {
      throw new BadRequestException(
        'Ngân sách danh mục bắt buộc chọn danh mục',
      );
    }

    return { scope, categoryId };
  }

  private async findOwnedBudget(userId: number, id: number) {
    const rows = await this.prisma.$queryRaw<BudgetRow[]>`
      SELECT
        b.id,
        b.user_id,
        b.name,
        b.scope,
        b.wallet_id,
        w.name AS wallet_name,
        w.currency AS wallet_currency,
        b.category_id,
        c.name AS category_name,
        b.limit_amount,
        b.period,
        b.start_date,
        b.end_date,
        b.is_active,
        b.deleted_at,
        b.created_at,
        b.updated_at
      FROM budgets b
      INNER JOIN wallets w ON w.id = b.wallet_id
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.id = ${id}
        AND b.user_id = ${userId}
        AND w.user_id = ${userId}
        AND COALESCE(b.is_active, 1) = 1
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  private async assertNoDuplicate(
    userId: number,
    scope: BudgetScope,
    walletId: number,
    categoryId: number | null,
    period: BudgetPeriod,
    startDate: Date,
    endDate: Date,
    ignoreBudgetId?: number,
  ) {
    const duplicate = await this.findDuplicateBudget(
      userId,
      scope,
      walletId,
      categoryId,
      period,
      startDate,
      endDate,
      ignoreBudgetId,
    );

    if (duplicate) {
      throw new BadRequestException('Ngân sách đã tồn tại trong kỳ đã chọn');
    }
  }

  private async findDuplicateBudget(
    userId: number,
    scope: BudgetScope,
    walletId: number,
    categoryId: number | null,
    period: BudgetPeriod,
    startDate: Date,
    endDate: Date,
    ignoreBudgetId?: number,
  ) {
    const ignoreId = ignoreBudgetId ?? 0;
    const rows =
      scope === BudgetScope.WALLET
        ? await this.prisma.$queryRaw<Array<{ id: number }>>`
            SELECT id
            FROM budgets
            WHERE user_id = ${userId}
              AND COALESCE(is_active, 1) = 1
              AND scope = ${scope}
              AND wallet_id = ${walletId}
              AND period = ${period}
              AND start_date = ${startDate}
              AND end_date = ${endDate}
              AND category_id IS NULL
              AND (${ignoreId} = 0 OR id <> ${ignoreId})
            LIMIT 1
          `
        : await this.prisma.$queryRaw<Array<{ id: number }>>`
            SELECT id
            FROM budgets
            WHERE user_id = ${userId}
              AND COALESCE(is_active, 1) = 1
              AND scope = ${scope}
              AND wallet_id = ${walletId}
              AND category_id = ${categoryId}
              AND period = ${period}
              AND start_date = ${startDate}
              AND end_date = ${endDate}
              AND (${ignoreId} = 0 OR id <> ${ignoreId})
            LIMIT 1
          `;

    return rows[0] ?? null;
  }

  private async buildCategoryLimitWarning(
    userId: number,
    walletId: number,
    startDate: Date,
    endDate: Date,
    categoryLimitAmount: Prisma.Decimal,
    ignoreBudgetId?: number,
  ) {
    const walletRows = await this.prisma.$queryRaw<
      Array<{ limit_amount: Prisma.Decimal }>
    >`
      SELECT limit_amount
      FROM budgets
      WHERE user_id = ${userId}
        AND COALESCE(is_active, 1) = 1
        AND scope = ${BudgetScope.WALLET}
        AND wallet_id = ${walletId}
        AND category_id IS NULL
        AND start_date = ${startDate}
        AND end_date = ${endDate}
      LIMIT 1
    `;

    if (walletRows.length === 0) {
      return null;
    }

    const ignoreId = ignoreBudgetId ?? 0;
    const categoryRows = await this.prisma.$queryRaw<
      Array<{ total: Prisma.Decimal | null }>
    >`
      SELECT COALESCE(SUM(limit_amount), 0) AS total
      FROM budgets
      WHERE user_id = ${userId}
        AND COALESCE(is_active, 1) = 1
        AND scope = ${BudgetScope.CATEGORY}
        AND wallet_id = ${walletId}
        AND start_date = ${startDate}
        AND end_date = ${endDate}
        AND (${ignoreId} = 0 OR id <> ${ignoreId})
    `;

    const walletLimit = new Prisma.Decimal(walletRows[0].limit_amount);
    const categoryTotal = new Prisma.Decimal(categoryRows[0]?.total ?? 0).plus(
      categoryLimitAmount,
    );

    if (categoryTotal.greaterThan(walletLimit)) {
      return {
        code: 'CATEGORY_TOTAL_EXCEEDS_WALLET_BUDGET',
        message: 'Tổng ngân sách danh mục đang vượt ngân sách ví cùng kỳ',
        wallet_limit: Number(walletLimit),
        category_total: Number(categoryTotal),
      };
    }

    return null;
  }

  private getStatus(spent: number, limitAmount: number): BudgetStatus {
    if (spent > limitAmount) {
      return 'EXCEEDED';
    }

    if (spent >= limitAmount * 0.8) {
      return 'WARNING';
    }

    return 'NORMAL';
  }

  private async calculateSpent(row: BudgetRow) {
    const spentRows =
      row.scope === BudgetScope.CATEGORY
        ? await this.prisma.$queryRaw<Array<{ spent: Prisma.Decimal | null }>>`
            SELECT COALESCE(SUM(ABS(t.amount)), 0) AS spent
            FROM transactions t
            INNER JOIN wallets w ON w.id = t.wallet_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE w.user_id = ${row.user_id}
              AND t.wallet_id = ${row.wallet_id}
              AND t.category_id = ${row.category_id}
              AND t.amount < 0
              AND t.transaction_date >= ${row.start_date}
              AND t.transaction_date <= ${row.end_date}
              AND NOT (
                COALESCE(c.cash_flow_group, 'NORMAL') <> 'NORMAL'
                OR
                LOWER(COALESCE(c.icon, '')) LIKE '%loan%'
                OR LOWER(COALESCE(c.icon, '')) LIKE '%debt%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%loan%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%debt%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%vay%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%tra no%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%thu no%'
              )
          `
        : await this.prisma.$queryRaw<Array<{ spent: Prisma.Decimal | null }>>`
            SELECT COALESCE(SUM(ABS(t.amount)), 0) AS spent
            FROM transactions t
            INNER JOIN wallets w ON w.id = t.wallet_id
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE w.user_id = ${row.user_id}
              AND t.wallet_id = ${row.wallet_id}
              AND t.amount < 0
              AND t.transaction_date >= ${row.start_date}
              AND t.transaction_date <= ${row.end_date}
              AND NOT (
                COALESCE(c.cash_flow_group, 'NORMAL') <> 'NORMAL'
                OR
                LOWER(COALESCE(c.icon, '')) LIKE '%loan%'
                OR LOWER(COALESCE(c.icon, '')) LIKE '%debt%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%loan%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%debt%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%vay%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%tra no%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%thu no%'
              )
          `;

    return Number((spentRows ?? [])[0]?.spent ?? 0);
  }

  private previousPeriodRange(row: BudgetRow) {
    if (row.period === BudgetPeriod.CUSTOM) {
      return null;
    }

    const start = row.start_date;

    if (row.period === BudgetPeriod.DAY) {
      const previousStart = new Date(start);
      previousStart.setDate(previousStart.getDate() - 1);
      return {
        startDate: this.startOfDay(previousStart),
        endDate: this.endOfDay(previousStart),
      };
    }

    if (row.period === BudgetPeriod.WEEK) {
      const previousStart = new Date(start);
      previousStart.setDate(previousStart.getDate() - 7);
      const previousEnd = this.endOfDay(
        new Date(
          previousStart.getFullYear(),
          previousStart.getMonth(),
          previousStart.getDate() + 6,
        ),
      );

      return { startDate: previousStart, endDate: previousEnd };
    }

    if (row.period === BudgetPeriod.YEAR) {
      return {
        startDate: new Date(start.getFullYear() - 1, 0, 1, 0, 0, 0, 0),
        endDate: new Date(start.getFullYear() - 1, 11, 31, 23, 59, 59, 0),
      };
    }

    if (row.period === BudgetPeriod.QUARTER) {
      const previousQuarterStartMonth = start.getMonth() - 3;

      return {
        startDate: new Date(
          start.getFullYear(),
          previousQuarterStartMonth,
          1,
          0,
          0,
          0,
          0,
        ),
        endDate: new Date(
          start.getFullYear(),
          previousQuarterStartMonth + 3,
          0,
          23,
          59,
          59,
          0,
        ),
      };
    }

    return {
      startDate: new Date(
        start.getFullYear(),
        start.getMonth() - 1,
        1,
        0,
        0,
        0,
        0,
      ),
      endDate: new Date(
        start.getFullYear(),
        start.getMonth(),
        0,
        23,
        59,
        59,
        0,
      ),
    };
  }

  private async findPreviousMatchingBudget(row: BudgetRow) {
    const range = this.previousPeriodRange(row);

    if (!range) {
      return null;
    }

    const rows =
      row.scope === BudgetScope.WALLET
        ? ((await this.prisma.$queryRaw<BudgetRow[]>`
            SELECT
              b.id,
              b.user_id,
              b.name,
              b.scope,
              b.wallet_id,
              w.name AS wallet_name,
              w.currency AS wallet_currency,
              b.category_id,
              c.name AS category_name,
              b.limit_amount,
              b.period,
              b.start_date,
              b.end_date,
              b.is_active,
              b.deleted_at,
              b.created_at,
              b.updated_at
            FROM budgets b
            INNER JOIN wallets w ON w.id = b.wallet_id
            LEFT JOIN categories c ON c.id = b.category_id
            WHERE b.user_id = ${row.user_id}
              AND COALESCE(b.is_active, 1) = 1
              AND b.scope = ${row.scope}
              AND b.wallet_id = ${row.wallet_id}
              AND b.category_id IS NULL
              AND b.period = ${row.period}
              AND b.start_date = ${range.startDate}
              AND b.end_date = ${range.endDate}
            LIMIT 1
          `) ?? [])
        : ((await this.prisma.$queryRaw<BudgetRow[]>`
            SELECT
              b.id,
              b.user_id,
              b.name,
              b.scope,
              b.wallet_id,
              w.name AS wallet_name,
              w.currency AS wallet_currency,
              b.category_id,
              c.name AS category_name,
              b.limit_amount,
              b.period,
              b.start_date,
              b.end_date,
              b.is_active,
              b.deleted_at,
              b.created_at,
              b.updated_at
            FROM budgets b
            INNER JOIN wallets w ON w.id = b.wallet_id
            LEFT JOIN categories c ON c.id = b.category_id
            WHERE b.user_id = ${row.user_id}
              AND COALESCE(b.is_active, 1) = 1
              AND b.scope = ${row.scope}
              AND b.wallet_id = ${row.wallet_id}
              AND b.category_id = ${row.category_id}
              AND b.period = ${row.period}
              AND b.start_date = ${range.startDate}
              AND b.end_date = ${range.endDate}
            LIMIT 1
          `) ?? []);

    return rows[0] ?? null;
  }

  private async decorateBudget(
    row: BudgetRow,
    warning: unknown = null,
    includeForecast = false,
  ) {
    const limitAmount = Number(row.limit_amount);
    const spent = await this.calculateSpent(row);
    const previousBudget = await this.findPreviousMatchingBudget(row);
    const previousSpent = previousBudget
      ? await this.calculateSpent(previousBudget)
      : 0;
    const previousLimit = previousBudget
      ? Number(previousBudget.limit_amount)
      : 0;
    const carryOverOverspent = Math.max(0, previousSpent - previousLimit);
    const rawAvailableLimitAmount = limitAmount - carryOverOverspent;
    const availableLimitAmount = Math.max(0, rawAvailableLimitAmount);
    const percent =
      limitAmount > 0 ? Math.round((spent / limitAmount) * 100) : 0;
    const effectivePercent =
      rawAvailableLimitAmount > 0
        ? Math.round((spent / availableLimitAmount) * 100)
        : limitAmount > 0
          ? Math.max(
              100,
              Math.round(((carryOverOverspent + spent) / limitAmount) * 100),
            )
          : 0;
    const effectiveStatus =
      rawAvailableLimitAmount > 0
        ? this.getStatus(spent, availableLimitAmount)
        : rawAvailableLimitAmount < 0 || spent > 0
          ? 'EXCEEDED'
          : 'WARNING';

    const result = {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      scope: row.scope,
      wallet_id: row.wallet_id,
      wallet_name: row.wallet_name,
      wallet_currency: row.wallet_currency,
      category_id: row.category_id,
      category_name: row.category_name,
      limit_amount: limitAmount,
      original_limit_amount: limitAmount,
      carry_over_overspent: carryOverOverspent,
      available_limit_amount: availableLimitAmount,
      amount: limitAmount,
      period: row.period,
      start_date: row.start_date,
      end_date: row.end_date,
      is_active: row.is_active,
      deleted_at: row.deleted_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      spent,
      remaining: limitAmount - spent,
      effective_remaining: rawAvailableLimitAmount - spent,
      percent,
      percentage: percent,
      effective_percent: effectivePercent,
      status: effectiveStatus,
      warning,
    };

    return includeForecast
      ? {
          ...result,
          forecast: buildBudgetForecast({
            startDate: row.start_date,
            endDate: row.end_date,
            evaluationDate: new Date(),
            spent,
            availableLimit: availableLimitAmount,
          }),
        }
      : result;
  }

  async findAll(
    userId: number,
    query: BudgetListQuery,
  ): Promise<{
    data: any[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }>;
  async findAll(
    userId: number,
    walletId?: number,
    scope?: BudgetScope,
  ): Promise<any[]>;
  async findAll(
    userId: number,
    walletIdOrQuery?: number | BudgetListQuery,
    legacyScope?: BudgetScope,
  ) {
    const query: BudgetListQuery =
      typeof walletIdOrQuery === 'object'
        ? walletIdOrQuery
        : { walletId: walletIdOrQuery, scope: legacyScope };
    const walletId = query.walletId;
    const scope = query.scope;
    if (walletId !== undefined) {
      await this.getOwnedWallet(userId, walletId);
    }

    const range = this.getListRange(query);
    const hasRange = Boolean(range);
    const rangeStart = range?.startDate ?? new Date(0);
    const rangeEnd = range?.endDate ?? new Date(0);
    const search = query.query?.trim() ?? '';
    const shouldPaginate =
      query.page !== undefined || query.limit !== undefined;
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const offset = (page - 1) * limit;

    const baseWhere = Prisma.sql`
      WHERE b.user_id = ${userId}
        AND w.user_id = ${userId}
        AND COALESCE(b.is_active, 1) = 1
        AND COALESCE(w.is_active, 1) = 1
        AND (${walletId ?? 0} = 0 OR b.wallet_id = ${walletId ?? 0})
        AND (${scope ?? ''} = '' OR b.scope = ${scope ?? ''})
        AND (${search} = '' OR LOWER(b.name) LIKE ${`%${search.toLowerCase()}%`} OR LOWER(w.name) LIKE ${`%${search.toLowerCase()}%`} OR LOWER(COALESCE(c.name, '')) LIKE ${`%${search.toLowerCase()}%`})
        AND (${hasRange} = FALSE OR (b.start_date <= ${rangeEnd} AND b.end_date > ${rangeStart}))
    `;

    const rows = await this.prisma.$queryRaw<BudgetRow[]>(Prisma.sql`
      SELECT
        b.id,
        b.user_id,
        b.name,
        b.scope,
        b.wallet_id,
        w.name AS wallet_name,
        w.currency AS wallet_currency,
        b.category_id,
        c.name AS category_name,
        b.limit_amount,
        b.period,
        b.start_date,
        b.end_date,
        b.is_active,
        b.deleted_at,
        b.created_at,
        b.updated_at
      FROM budgets b
      INNER JOIN wallets w ON w.id = b.wallet_id
      LEFT JOIN categories c ON c.id = b.category_id
      ${baseWhere}
      ORDER BY b.start_date DESC, b.id DESC
      ${shouldPaginate ? Prisma.sql`LIMIT ${limit} OFFSET ${offset}` : Prisma.empty}
    `);

    if (!shouldPaginate) {
      return Promise.all(rows.map((row) => this.decorateBudget(row)));
    }

    const countRows = await this.prisma.$queryRaw<
      Array<{ total: bigint | number }>
    >(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM budgets b
      INNER JOIN wallets w ON w.id = b.wallet_id
      LEFT JOIN categories c ON c.id = b.category_id
      ${baseWhere}
    `);
    const total = Number(countRows[0]?.total ?? 0);
    const data = await Promise.all(rows.map((row) => this.decorateBudget(row)));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(userId: number, id: number) {
    const budget = await this.findOwnedBudget(userId, id);

    if (!budget) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    return this.decorateBudget(budget, null, true);
  }

  async findTransactions(
    userId: number,
    budgetId: number,
    requestedPage = 1,
    requestedLimit = 10,
  ) {
    const budget = await this.findOwnedBudget(userId, budgetId);
    if (!budget) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    const page = Math.max(1, requestedPage || 1);
    const limit = Math.min(100, Math.max(1, requestedLimit || 10));
    const offset = (page - 1) * limit;
    const isCategoryBudget = budget.scope === BudgetScope.CATEGORY;
    const categoryId = budget.category_id ?? 0;
    const eligibleWhere = Prisma.sql`
      WHERE w.user_id = ${userId}
        AND t.wallet_id = ${budget.wallet_id}
        AND t.amount < 0
        AND t.transaction_date >= ${budget.start_date}
        AND t.transaction_date <= ${budget.end_date}
        AND (${isCategoryBudget} = FALSE OR t.category_id = ${categoryId})
        AND NOT (
          COALESCE(c.cash_flow_group, 'NORMAL') <> 'NORMAL'
          OR LOWER(COALESCE(c.icon, '')) LIKE '%loan%'
          OR LOWER(COALESCE(c.icon, '')) LIKE '%debt%'
          OR LOWER(COALESCE(c.name, '')) LIKE '%loan%'
          OR LOWER(COALESCE(c.name, '')) LIKE '%debt%'
          OR LOWER(COALESCE(c.name, '')) LIKE '%vay%'
          OR LOWER(COALESCE(c.name, '')) LIKE '%tra no%'
          OR LOWER(COALESCE(c.name, '')) LIKE '%thu no%'
        )
    `;

    const rows = await this.prisma.$queryRaw<BudgetTransactionRow[]>(Prisma.sql`
      SELECT
        t.id,
        t.wallet_id,
        w.name AS wallet_name,
        t.category_id,
        c.name AS category_name,
        c.icon AS category_icon,
        t.amount,
        w.currency AS currency,
        t.note,
        t.transaction_date,
        t.created_at
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id
      LEFT JOIN categories c ON c.id = t.category_id
      ${eligibleWhere}
      ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const countRows = await this.prisma.$queryRaw<
      Array<{ total: bigint | number }>
    >(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id
      LEFT JOIN categories c ON c.id = t.category_id
      ${eligibleWhere}
    `);
    const total = Number(countRows[0]?.total ?? 0);

    return {
      data: rows.map((row) => ({
        id: row.id,
        wallet_id: row.wallet_id,
        wallet_name: row.wallet_name,
        category_id: row.category_id,
        category_name: row.category_name,
        category_icon: row.category_icon,
        amount: Math.abs(Number(row.amount)),
        currency: row.currency,
        note: row.note,
        transaction_date: row.transaction_date,
        created_at: row.created_at,
        type: 'EXPENSE' as const,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async create(userId: number, dto: CreateBudgetDto) {
    const name = this.normalizeBudgetName(dto.name);
    await this.getOwnedWallet(userId, dto.wallet_id);
    const { scope, categoryId } = this.normalizeScopeInput(
      dto.scope,
      dto.category_id,
    );

    if (scope === BudgetScope.CATEGORY) {
      await this.getExpenseCategory(userId, categoryId);
    }

    const limitAmount = this.toPositiveDecimal(dto.limit_amount);
    const { startDate, endDate } = this.normalizePeriodRange({
      period: dto.period,
      startDate: dto.start_date,
      endDate: dto.end_date,
    });

    await this.assertNoDuplicate(
      userId,
      scope,
      dto.wallet_id,
      categoryId,
      dto.period,
      startDate,
      endDate,
    );

    const warning =
      scope === BudgetScope.CATEGORY
        ? await this.buildCategoryLimitWarning(
            userId,
            dto.wallet_id,
            startDate,
            endDate,
            limitAmount,
          )
        : null;

    const created = await this.prisma.budgets
      .create({
        data: {
          user_id: userId,
          name,
          wallet_id: dto.wallet_id,
          category_id: categoryId,
          scope,
          limit_amount: limitAmount,
          period: dto.period,
          start_date: startDate,
          end_date: endDate,
        },
        select: { id: true },
      })
      .catch((error: unknown) => {
        if (this.isDuplicateBudgetWriteError(error)) {
          this.throwDuplicateBudget();
        }

        throw error;
      });

    const createdBudget = await this.findOwnedBudget(userId, created.id);
    if (!createdBudget) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    return this.decorateBudget(createdBudget, warning);
  }

  async update(userId: number, id: number, dto: UpdateBudgetDto) {
    const current = await this.findOwnedBudget(userId, id);

    if (!current) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    const nextName =
      dto.name !== undefined
        ? this.normalizeBudgetName(dto.name)
        : current.name;

    const nextWalletId = dto.wallet_id ?? current.wallet_id;
    await this.getOwnedWallet(userId, nextWalletId);

    const nextScope = dto.scope ?? current.scope;
    const rawCategoryId = Object.prototype.hasOwnProperty.call(
      dto,
      'category_id',
    )
      ? dto.category_id
      : current.category_id;
    const { scope, categoryId } = this.normalizeScopeInput(
      nextScope,
      rawCategoryId,
    );

    if (scope === BudgetScope.CATEGORY) {
      await this.getExpenseCategory(userId, categoryId);
    }

    const limitAmount =
      dto.limit_amount !== undefined
        ? this.toPositiveDecimal(dto.limit_amount)
        : current.limit_amount;
    const nextPeriod = dto.period ?? current.period;
    const { startDate, endDate } = this.normalizePeriodRange({
      period: nextPeriod,
      startDate: dto.start_date,
      endDate: dto.end_date,
      fallbackStart: current.start_date,
      fallbackEnd: current.end_date,
    });

    await this.assertNoDuplicate(
      userId,
      scope,
      nextWalletId,
      categoryId,
      nextPeriod,
      startDate,
      endDate,
      id,
    );

    const warning =
      scope === BudgetScope.CATEGORY
        ? await this.buildCategoryLimitWarning(
            userId,
            nextWalletId,
            startDate,
            endDate,
            new Prisma.Decimal(limitAmount),
            id,
          )
        : null;

    await this.prisma.budgets
      .update({
        where: { id },
        data: {
          name: nextName,
          wallet_id: nextWalletId,
          category_id: categoryId,
          scope,
          limit_amount: limitAmount,
          period: nextPeriod,
          start_date: startDate,
          end_date: endDate,
        },
      })
      .catch((error: unknown) => {
        if (this.isDuplicateBudgetWriteError(error)) {
          this.throwDuplicateBudget();
        }

        throw error;
      });

    const updatedBudget = await this.findOwnedBudget(userId, id);
    if (!updatedBudget) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    return this.decorateBudget(updatedBudget, warning);
  }

  async createNextPeriod(userId: number, id: number) {
    const current = await this.findOwnedBudget(userId, id);

    if (!current) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    if (current.period === BudgetPeriod.CUSTOM) {
      throw new BadRequestException(
        'Ngân sách tùy chọn không hỗ trợ tạo kỳ tiếp theo tự động',
      );
    }

    const { startDate, endDate } = this.nextPeriodRange(
      current.period,
      current.end_date,
    );

    const duplicate = await this.findDuplicateBudget(
      userId,
      current.scope,
      current.wallet_id,
      current.category_id,
      current.period,
      startDate,
      endDate,
    );

    if (duplicate) {
      const existingBudget = await this.findOwnedBudget(userId, duplicate.id);
      if (!existingBudget) {
        throw new NotFoundException('Không tìm thấy ngân sách');
      }

      return {
        creation_state: 'existing' as const,
        budget: await this.decorateBudget(existingBudget),
      };
    }

    const warning =
      current.scope === BudgetScope.CATEGORY
        ? await this.buildCategoryLimitWarning(
            userId,
            current.wallet_id,
            startDate,
            endDate,
            current.limit_amount,
          )
        : null;

    let created: { id: number };
    let creationState: 'created' | 'existing' = 'created';
    try {
      created = await this.prisma.budgets.create({
        data: {
          user_id: userId,
          name: current.name,
          wallet_id: current.wallet_id,
          category_id: current.category_id,
          scope: current.scope,
          limit_amount: current.limit_amount,
          period: current.period,
          start_date: startDate,
          end_date: endDate,
        },
        select: { id: true },
      });
    } catch (error) {
      if (!this.isDuplicateBudgetWriteError(error)) {
        throw error;
      }

      const racedDuplicate = await this.findDuplicateBudget(
        userId,
        current.scope,
        current.wallet_id,
        current.category_id,
        current.period,
        startDate,
        endDate,
      );
      if (!racedDuplicate) {
        throw error;
      }
      created = racedDuplicate;
      creationState = 'existing';
    }

    const createdBudget = await this.findOwnedBudget(userId, created.id);
    if (!createdBudget) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    return {
      creation_state: creationState,
      budget: await this.decorateBudget(createdBudget, warning),
    };
  }

  async remove(userId: number, id: number) {
    const current = await this.findOwnedBudget(userId, id);

    if (!current) {
      throw new NotFoundException('Không tìm thấy ngân sách');
    }

    await this.prisma.budgets.update({
      where: { id },
      data: {
        is_active: false,
        deleted_at: new Date(),
      },
    });

    return this.decorateBudget(current);
  }
}
