import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { categories_type, Prisma } from '@prisma/client';
import {
  deleteCategoryIcon,
  saveCategoryIcon,
} from '../common/upload/category-icon-upload.helper';
import { isNormalCashFlow } from '../common/finance/cash-flow-classification';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from '../categories/dto/create-categories.dto';
import { UpdateCategoryDto } from '../categories/dto/update-categories.dto';

const ADMIN_REPORTING_CURRENCY = 'VND';

const monthLabels = [
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
  'T11',
  'T12',
];

type InsightSeverity = 'danger' | 'warning' | 'success';

type ConvertedTransaction = {
  id: number;
  amount: number;
  transaction_date: Date;
  category_id?: number | null;
  wallet_id?: number | null;
};

type PeriodKey = 'all' | 'day' | 'week' | 'month' | 'quarter' | 'year';

type TrendPoint = {
  label: string;
  start: string;
  end: string;
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
};

type CategoryMeta = {
  name: string;
  icon?: string | null;
  cash_flow_group?: string | null;
  isSystem: boolean;
  userId: number | null;
};

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private toNumber(value: Prisma.Decimal | number | null | undefined) {
    if (value instanceof Prisma.Decimal) {
      return value.toNumber();
    }

    return Number(value || 0);
  }

  private deduplicateVisibleCategories<
    T extends {
      id: number;
      name: string;
      type: string;
      is_system?: boolean | null;
      user_id?: number | null;
    },
  >(categories: T[]) {
    const categoriesByKey = new Map<string, T>();

    for (const category of categories) {
      const scopeKey = category.is_system
        ? 'system'
        : `user:${category.user_id ?? 'none'}`;
      const key = `${scopeKey}:${category.type}:${category.name.trim().toLowerCase()}`;
      const existed = categoriesByKey.get(key);

      if (!existed || category.id < existed.id) {
        categoriesByKey.set(key, category);
      }
    }

    return Array.from(categoriesByKey.values()).sort((left, right) => {
      const systemCompare =
        Number(right.is_system ?? false) - Number(left.is_system ?? false);

      if (systemCompare !== 0) {
        return systemCompare;
      }

      const nameCompare = left.name.localeCompare(right.name, 'vi');

      return nameCompare !== 0 ? nameCompare : left.id - right.id;
    });
  }

  async getCategories() {
    const categories = this.deduplicateVisibleCategories(
      await this.prisma.categories.findMany({
        where: { OR: [{ is_active: true }, { is_active: null }] },
        orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
      }),
    );
    const userIds = Array.from(
      new Set(
        categories
          .map((category) => category.user_id)
          .filter((userId): userId is number => typeof userId === 'number'),
      ),
    );
    const users = userIds.length
      ? await this.prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, full_name: true },
        })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    return categories.map((category) => {
      const owner = category.user_id
        ? usersById.get(category.user_id)
        : undefined;

      return {
        ...category,
        owner_name: owner?.full_name ?? null,
        owner_email: owner?.email ?? null,
      };
    });
  }

  private async assertAdminCategoryNameAvailable(
    name: string,
    type: categories_type,
    isSystem: boolean,
    ownerUserId: number | null,
    excludeId?: number,
  ) {
    const existed = await this.prisma.categories.findFirst({
      where: isSystem
        ? {
            name,
            type,
            is_system: true,
            OR: [{ is_active: true }, { is_active: null }],
            ...(excludeId ? { NOT: { id: excludeId } } : {}),
          }
        : {
            name,
            type,
            AND: [
              { OR: [{ is_active: true }, { is_active: null }] },
              { OR: [{ is_system: true }, { user_id: ownerUserId }] },
            ],
            ...(excludeId ? { NOT: { id: excludeId } } : {}),
          },
    });

    if (existed) {
      throw new BadRequestException('Danh mục đã tồn tại');
    }
  }

  async createCategory(actorUserId: number, dto: CreateCategoryDto) {
    const name = dto.name.trim().toLowerCase();
    const isSystem = dto.is_system === true;
    const ownerUserId = isSystem ? null : actorUserId;

    await this.assertAdminCategoryNameAvailable(
      name,
      dto.type,
      isSystem,
      ownerUserId,
    );

    return this.prisma.categories.create({
      data: {
        name,
        type: dto.type,
        cash_flow_group: dto.cash_flow_group ?? 'NORMAL',
        is_system: isSystem,
        user_id: ownerUserId,
      },
    });
  }

  async updateCategory(id: number, dto: UpdateCategoryDto) {
    const category = await this.prisma.categories.findUnique({ where: { id } });

    if (!category || category.is_active === false) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    if (!dto.name && !dto.type && !dto.cash_flow_group) {
      throw new BadRequestException('Không có dữ liệu để cập nhật');
    }

    const name = dto.name?.trim().toLowerCase() ?? category.name;
    const type = dto.type ?? category.type;
    const isSystem = category.is_system === true;

    await this.assertAdminCategoryNameAvailable(
      name,
      type,
      isSystem,
      category.user_id ?? null,
      id,
    );

    return this.prisma.categories.update({
      where: { id },
      data: {
        name,
        type,
        cash_flow_group: dto.cash_flow_group,
      },
    });
  }

  async removeCategory(id: number) {
    const category = await this.prisma.categories.findUnique({ where: { id } });

    if (!category || category.is_active === false) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    return this.prisma.categories.update({
      where: { id },
      data: {
        is_active: false,
        deleted_at: new Date(),
      },
    });
  }

  async uploadCategoryIcon(id: number, file: Express.Multer.File) {
    const category = await this.prisma.categories.findUnique({ where: { id } });

    if (!category || category.is_active === false) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    const iconPath = await saveCategoryIcon(file);
    const updatedCategory = await this.prisma.categories.update({
      where: { id },
      data: { icon: iconPath },
    });

    await deleteCategoryIcon(category.icon);

    return updatedCategory;
  }

  private getStartOfWeek(date: Date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;

    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);

    return start;
  }

  private getStartOfDay(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private getDateFromQuery(date?: string) {
    if (!date) {
      return new Date();
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

    if (!match) {
      throw new BadRequestException('Ngày thống kê không hợp lệ');
    }

    const parsed = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Ngày thống kê không hợp lệ');
    }

    return parsed;
  }

  private normalizePeriod(period?: string): PeriodKey {
    const normalized = (period ?? 'month')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/_/g, '-');

    if (['all', 'tat-ca', 'tatca'].includes(normalized)) {
      return 'all';
    }

    if (['day', 'week', 'month', 'quarter', 'year'].includes(normalized)) {
      return normalized as PeriodKey;
    }

    throw new BadRequestException('Kỳ thống kê không hợp lệ');
  }

  private getPeriodRange(period: PeriodKey, date: Date) {
    const start =
      period === 'all'
        ? new Date(1970, 0, 1)
        : period === 'day'
          ? this.getStartOfDay(date)
          : period === 'week'
            ? this.getStartOfWeek(date)
            : period === 'month'
              ? new Date(date.getFullYear(), date.getMonth(), 1)
              : period === 'quarter'
                ? new Date(
                    date.getFullYear(),
                    Math.floor(date.getMonth() / 3) * 3,
                    1,
                  )
                : new Date(date.getFullYear(), 0, 1);
    const end = new Date(start);

    if (period === 'all') {
      end.setFullYear(date.getFullYear() + 1, 0, 1);
    } else if (period === 'day') {
      end.setDate(end.getDate() + 1);
    } else if (period === 'week') {
      end.setDate(end.getDate() + 7);
    } else if (period === 'month') {
      end.setMonth(end.getMonth() + 1);
    } else if (period === 'quarter') {
      end.setMonth(end.getMonth() + 3);
    } else {
      end.setFullYear(end.getFullYear() + 1);
    }

    const tomorrow = this.getStartOfDay(new Date());
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (end > tomorrow) {
      end.setTime(tomorrow.getTime());
    }

    const previousStart = new Date(start);
    const previousEnd = new Date(end);

    if (period === 'all') {
      previousStart.setTime(start.getTime());
      previousEnd.setTime(start.getTime());
    } else if (period === 'day') {
      previousStart.setDate(previousStart.getDate() - 1);
      previousEnd.setDate(previousEnd.getDate() - 1);
    } else if (period === 'week') {
      previousStart.setDate(previousStart.getDate() - 7);
      previousEnd.setDate(previousEnd.getDate() - 7);
    } else if (period === 'month') {
      previousStart.setMonth(previousStart.getMonth() - 1);
      previousEnd.setMonth(previousEnd.getMonth() - 1);
    } else if (period === 'quarter') {
      previousStart.setMonth(previousStart.getMonth() - 3);
      previousEnd.setMonth(previousEnd.getMonth() - 3);
    } else {
      previousStart.setFullYear(previousStart.getFullYear() - 1);
      previousEnd.setFullYear(previousEnd.getFullYear() - 1);
    }

    return { start, end, previousStart, previousEnd };
  }

  private formatDate(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private formatDayMonth(date: Date) {
    const day = `${date.getDate()}`.padStart(2, '0');
    const month = `${date.getMonth() + 1}`.padStart(2, '0');

    return `${day}/${month}`;
  }

  private getInclusiveEndDate(end: Date) {
    return this.formatDate(new Date(end.getTime() - 1));
  }

  private filterTransactionsByRange(
    transactions: ConvertedTransaction[],
    start: Date,
    end: Date,
  ) {
    return transactions.filter(
      (transaction) =>
        transaction.transaction_date >= start &&
        transaction.transaction_date < end,
    );
  }

  private buildTrendPoint(
    label: string,
    start: Date,
    end: Date,
    transactions: ConvertedTransaction[],
    categoryMeta: Map<number, CategoryMeta> = new Map(),
  ): TrendPoint {
    const summary = this.summarizeTransactions(
      this.filterTransactionsByRange(transactions, start, end),
      categoryMeta,
    );

    return {
      label,
      start: this.formatDate(start),
      end: this.getInclusiveEndDate(end),
      income: summary.income,
      expense: summary.expense,
      net: summary.net,
      transactionCount: summary.transactionCount,
    };
  }

  private buildPeriodChart(
    period: PeriodKey,
    range: { start: Date; end: Date },
    transactions: ConvertedTransaction[],
    categoryMeta: Map<number, CategoryMeta> = new Map(),
  ) {
    if (period === 'all') {
      const years = new Set<number>();

      transactions.forEach((transaction) => {
        years.add(transaction.transaction_date.getFullYear());
      });

      const currentYear = new Date().getFullYear();
      const sortedYears = Array.from(
        years.size ? years : new Set([currentYear]),
      ).sort((left, right) => left - right);

      return sortedYears.map((year) => {
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        return this.buildTrendPoint(
          `${year}`,
          start,
          end,
          transactions,
          categoryMeta,
        );
      });
    }

    if (period === 'day') {
      return Array.from({ length: 24 }, (_, hour) => {
        const start = new Date(range.start);
        start.setHours(hour, 0, 0, 0);
        const end = new Date(start);
        end.setHours(hour + 1, 0, 0, 0);

        return this.buildTrendPoint(
          `${`${hour}`.padStart(2, '0')}:00`,
          start,
          end,
          transactions,
          categoryMeta,
        );
      });
    }

    if (period === 'week') {
      const points: TrendPoint[] = [];
      const cursor = new Date(range.start);

      while (cursor < range.end) {
        const start = new Date(cursor);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        points.push(
          this.buildTrendPoint(
            this.formatDayMonth(start),
            start,
            end,
            transactions,
            categoryMeta,
          ),
        );
        cursor.setDate(cursor.getDate() + 1);
      }

      return points;
    }

    if (period === 'month') {
      return Array.from({ length: 4 }, (_, index) => {
        const start = new Date(
          range.start.getFullYear(),
          range.start.getMonth(),
          index * 7 + 1,
        );
        const monthEnd = new Date(
          range.start.getFullYear(),
          range.start.getMonth() + 1,
          1,
        );
        const end =
          index === 3
            ? monthEnd
            : new Date(
                range.start.getFullYear(),
                range.start.getMonth(),
                index * 7 + 8,
              );

        if (end > range.end) {
          end.setTime(range.end.getTime());
        }

        return this.buildTrendPoint(
          `Tuần ${index + 1} (${this.formatDayMonth(start)} - ${this.formatDayMonth(new Date(end.getTime() - 1))})`,
          start,
          end,
          transactions,
          categoryMeta,
        );
      }).filter((point) => point.start <= point.end);
    }

    const monthCount = period === 'quarter' ? 3 : 12;

    return Array.from({ length: monthCount }, (_, index) => {
      const start = new Date(
        range.start.getFullYear(),
        range.start.getMonth() + index,
        1,
      );
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      return this.buildTrendPoint(
        `T${start.getMonth() + 1}/${start.getFullYear()}`,
        start,
        end,
        transactions,
        categoryMeta,
      );
    });
  }

  private compareSummaries(
    current: ReturnType<typeof this.summarizeTransactions>,
    previous: ReturnType<typeof this.summarizeTransactions>,
  ) {
    const percent = (currentValue: number, previousValue: number) => {
      if (previousValue === 0) {
        return currentValue === 0 ? 0 : 100;
      }

      return Math.round(((currentValue - previousValue) / previousValue) * 100);
    };

    return {
      income: percent(current.income, previous.income),
      expense: percent(current.expense, previous.expense),
      net: percent(current.net, previous.net),
      transactionCount: percent(
        current.transactionCount,
        previous.transactionCount,
      ),
    };
  }

  private normalizeLogText(value?: string | null) {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private getLogActionGroup(action?: string | null) {
    const normalized = this.normalizeLogText(action);

    if (normalized.includes('dang nhap')) return 'LOGIN';
    if (normalized.includes('dang xuat')) return 'LOGOUT';
    if (normalized.includes('upload')) return 'UPLOAD';
    if (normalized.includes('xoa') || normalized.includes('vo hieu hoa'))
      return 'DELETE';
    if (
      normalized.includes('cap nhat') ||
      normalized.includes('sua') ||
      normalized.includes('doi')
    ) {
      return 'UPDATE';
    }
    if (normalized.includes('tao') || normalized.includes('them'))
      return 'CREATE';

    return 'ALL';
  }

  private getLogTargetGroup(action?: string | null) {
    const normalized = this.normalizeLogText(action);

    if (
      normalized.includes('nguoi dung') ||
      normalized.includes('user') ||
      normalized.includes('mat khau') ||
      normalized.includes('ho so')
    ) {
      return 'USER';
    }

    if (normalized.includes('danh muc')) return 'CATEGORY';
    if (normalized.includes('thong bao') || normalized.includes('broadcast')) {
      return 'NOTIFICATION';
    }

    return 'ALL';
  }

  private isImportantLog(action?: string | null) {
    const normalized = this.normalizeLogText(action);

    return normalized.startsWith('admin ');
  }

  private formatKnownLogAction(action?: string | null) {
    if (!action) {
      return action;
    }

    return action
      .replaceAll(
        'Nguoi dung dang nhap he thong',
        'Người dùng đăng nhập hệ thống',
      )
      .replaceAll(
        'Nguoi dung dang xuat he thong',
        'Người dùng đăng xuất hệ thống',
      )
      .replaceAll('Cap nhat ho so nguoi dung', 'Cập nhật hồ sơ người dùng')
      .replaceAll('Nguoi dung doi mat khau', 'Người dùng đổi mật khẩu')
      .replaceAll('Tao nguoi dung', 'Tạo người dùng')
      .replaceAll('Admin cap nhat nguoi dung', 'Admin cập nhật người dùng')
      .replaceAll('Admin xoa nguoi dung', 'Admin vô hiệu hóa người dùng');
  }

  private summarizeTransactions(
    transactions: ConvertedTransaction[],
    categoryMeta: Map<number, CategoryMeta> = new Map(),
  ) {
    const normalTransactions = transactions.filter((transaction) => {
      const category = transaction.category_id
        ? categoryMeta.get(transaction.category_id)
        : null;

      return isNormalCashFlow(category);
    });
    const incomeTransactions = normalTransactions.filter(
      (transaction) => transaction.amount >= 0,
    );
    const expenseTransactions = normalTransactions.filter(
      (transaction) => transaction.amount < 0,
    );
    const income = incomeTransactions.reduce(
      (sum, transaction) => sum + transaction.amount,
      0,
    );
    const expense = expenseTransactions.reduce(
      (sum, transaction) => sum + Math.abs(transaction.amount),
      0,
    );
    const categoryTotals = new Map<
      number,
      { income: number; expense: number; total: number }
    >();
    const walletTotals = new Map<number, number>();

    normalTransactions.forEach((transaction) => {
      const amount = transaction.amount;

      if (transaction.category_id) {
        const current = categoryTotals.get(transaction.category_id) ?? {
          income: 0,
          expense: 0,
          total: 0,
        };

        if (amount >= 0) {
          current.income += amount;
        } else {
          current.expense += Math.abs(amount);
        }

        current.total += Math.abs(amount);
        categoryTotals.set(transaction.category_id, current);
      }

      if (transaction.wallet_id) {
        walletTotals.set(
          transaction.wallet_id,
          (walletTotals.get(transaction.wallet_id) ?? 0) + Math.abs(amount),
        );
      }
    });

    const biggestIncome = incomeTransactions.reduce(
      (max, transaction) => Math.max(max, transaction.amount),
      0,
    );
    const biggestExpense = expenseTransactions.reduce(
      (max, transaction) => Math.max(max, Math.abs(transaction.amount)),
      0,
    );

    return {
      income,
      expense,
      net: income - expense,
      transactionCount: normalTransactions.length,
      incomeCount: incomeTransactions.length,
      expenseCount: expenseTransactions.length,
      averageTransaction: normalTransactions.length
        ? (income + expense) / normalTransactions.length
        : 0,
      expenseToIncomeRate:
        income > 0 ? Math.round((expense / income) * 100) : 0,
      biggestIncome,
      biggestExpense,
      categoryTotals: Array.from(categoryTotals.entries()).map(
        ([categoryId, totals]) => ({
          categoryId,
          name: categoryMeta.get(categoryId)?.name ?? 'Chưa phân loại',
          ...totals,
        }),
      ),
      walletTotals: Array.from(walletTotals.entries()).map(
        ([walletId, total]) => ({
          walletId,
          total,
        }),
      ),
    };
  }

  private async convertTransactions(
    transactions: Array<{
      id: number;
      amount: Prisma.Decimal;
      currency?: string | null;
      converted_amount?: Prisma.Decimal | null;
      converted_currency?: string | null;
      exchange_rate_used?: Prisma.Decimal | null;
      transaction_date: Date;
      category_id?: number | null;
      wallet_id?: number | null;
    }>,
    walletCurrencyMap: Map<number, string>,
    targetCurrency: string,
  ) {
    return Promise.all(
      transactions.map(async (transaction) => {
        const walletCurrency = this.currencyService.normalizeCurrency(
          walletCurrencyMap.get(transaction.wallet_id ?? 0),
        );
        const signedAmount = this.toNumber(transaction.amount);
        const normalizedTarget =
          this.currencyService.normalizeCurrency(targetCurrency);
        const absoluteAmount =
          transaction.converted_amount &&
          transaction.converted_currency &&
          this.currencyService.normalizeCurrency(
            transaction.converted_currency,
          ) === normalizedTarget
            ? { amount: Number(transaction.converted_amount) }
            : await this.currencyService.convertAmount(
                Math.abs(signedAmount),
                transaction.currency ?? walletCurrency,
                normalizedTarget,
              );

        return {
          ...transaction,
          amount:
            signedAmount >= 0 ? absoluteAmount.amount : -absoluteAmount.amount,
        };
      }),
    );
  }

  async createLog(adminId: number, action?: string) {
    if (!action?.trim()) {
      throw new BadRequestException('Nội dung nhật ký không được để trống');
    }

    return this.prisma.admin_logs.create({
      data: {
        admin_id: adminId,
        action: action.trim(),
      },
    });
  }

  async getLogs(
    query: {
      page?: number;
      limit?: number;
      action?: string;
      target?: string;
      date?: string;
      sort?: string;
    } = {},
  ) {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 10), 1), 100);
    const logs = await this.prisma.admin_logs.findMany({
      where: {
        NOT: [
          { action: { contains: 'xem trang thong ke tong quan' } },
          { action: { contains: 'xem dashboard' } },
          { action: { contains: 'refresh' } },
          { action: { contains: 'chuyen tab' } },
        ],
      },
      orderBy: { created_at: query.sort === 'time_asc' ? 'asc' : 'desc' },
    });

    const formattedLogs = logs
      .filter((log) => this.isImportantLog(log.action))
      .filter((log) =>
        query.action && query.action !== 'ALL'
          ? this.getLogActionGroup(log.action) === query.action
          : true,
      )
      .filter((log) =>
        query.target && query.target !== 'ALL'
          ? this.getLogTargetGroup(log.action) === query.target
          : true,
      )
      .filter((log) =>
        query.date
          ? log.created_at?.toISOString().slice(0, 10) === query.date
          : true,
      )
      .map((log) => ({
        ...log,
        action: this.formatKnownLogAction(log.action),
      }));

    if (!query.page && !query.limit) {
      return formattedLogs.slice(0, 50);
    }

    const total = formattedLogs.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const start = (page - 1) * limit;

    return {
      data: formattedLogs.slice(start, start + limit),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getDashboard(adminUserId: number, date?: string, period?: string) {
    void adminUserId;
    const targetCurrency = ADMIN_REPORTING_CURRENCY;

    const selectedPeriod = this.normalizePeriod(period);
    const selectedDate = this.getDateFromQuery(date);
    const today = this.getStartOfDay(new Date());
    if (selectedDate > today) {
      selectedDate.setTime(today.getTime());
    }
    const periodRange = this.getPeriodRange(selectedPeriod, selectedDate);
    const startOfDay = this.getStartOfDay(selectedDate);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const startOfWeek = this.getStartOfWeek(selectedDate);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const startOfMonth = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      1,
    );
    const endOfMonth = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth() + 1,
      1,
    );
    const startOfYear = new Date(selectedDate.getFullYear(), 0, 1);
    const endOfYear = new Date(selectedDate.getFullYear() + 1, 0, 1);
    const tomorrow = this.getStartOfDay(new Date());
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (endOfYear > tomorrow) {
      endOfYear.setTime(tomorrow.getTime());
    }
    const transactionQueryStart =
      selectedPeriod === 'all'
        ? periodRange.start
        : periodRange.previousStart < startOfYear
          ? periodRange.previousStart
          : startOfYear;
    const transactionQueryEnd =
      selectedPeriod === 'all'
        ? periodRange.end
        : periodRange.end > endOfYear
          ? periodRange.end
          : endOfYear;

    const [
      totalUsers,
      premiumUsers,
      basicUsers,
      adminUsers,
      totalWallets,
      negativeWallets,
      totalCategories,
      totalTransactions,
      wallets,
      walletMetadata,
      budgets,
      yearTransactions,
      recentLogs,
      categories,
      usersWithWalletCounts,
    ] = await Promise.all([
      this.prisma.users.count({
        where: { OR: [{ is_active: true }, { is_active: null }] },
      }),
      this.prisma.users.count({
        where: {
          role: 'PREMIUM',
          OR: [{ is_active: true }, { is_active: null }],
        },
      }),
      this.prisma.users.count({
        where: {
          role: 'BASIC',
          OR: [{ is_active: true }, { is_active: null }],
        },
      }),
      this.prisma.users.count({
        where: {
          role: 'ADMIN',
          OR: [{ is_active: true }, { is_active: null }],
        },
      }),
      this.prisma.wallets.count({
        where: { OR: [{ is_active: true }, { is_active: null }] },
      }),
      this.prisma.wallets.count({
        where: {
          OR: [{ is_active: true }, { is_active: null }],
          balance: {
            lt: 0,
          },
        },
      }),
      this.prisma.categories.count({
        where: { OR: [{ is_active: true }, { is_active: null }] },
      }),
      this.prisma.transactions.count(),
      this.prisma.$queryRaw<
        Array<{
          id: number;
          name: string;
          currency: string;
          balance: Prisma.Decimal | null;
        }>
      >`
        SELECT id, name, currency, balance
        FROM wallets
        WHERE COALESCE(is_active, 1) = 1
      `,
      this.prisma.$queryRaw<
        Array<{
          id: number;
          name: string;
          currency: string;
        }>
      >`
        SELECT id, name, currency
        FROM wallets
      `,
      this.prisma.$queryRaw<
        Array<{
          wallet_id: number;
          amount: Prisma.Decimal;
          start_date: Date;
          end_date: Date;
        }>
      >`
        SELECT b.wallet_id, b.limit_amount AS amount, b.start_date, b.end_date
        FROM budgets b
        INNER JOIN wallets w ON w.id = b.wallet_id
        WHERE COALESCE(b.is_active, 1) = 1
          AND COALESCE(w.is_active, 1) = 1
          AND b.scope = 'WALLET'
          AND b.category_id IS NULL
          AND b.start_date < ${endOfMonth}
          AND b.end_date >= ${startOfMonth}
      `,
      this.prisma.transactions.findMany({
        where: {
          transaction_date: {
            gte: transactionQueryStart,
            lt: transactionQueryEnd,
          },
        },
        select: {
          id: true,
          amount: true,
          currency: true,
          converted_amount: true,
          converted_currency: true,
          exchange_rate_used: true,
          transaction_date: true,
          category_id: true,
          wallet_id: true,
        },
      }),
      this.prisma.admin_logs.findMany({
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
      this.prisma.categories.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          icon: true,
          cash_flow_group: true,
          is_system: true,
          user_id: true,
        },
      }),
      this.prisma.$queryRaw<
        Array<{
          id: number;
          role: string | null;
          wallet_count: bigint | number;
        }>
      >`
        SELECT u.id, u.role, COUNT(w.id) AS wallet_count
        FROM users u
        LEFT JOIN wallets w ON w.user_id = u.id AND COALESCE(w.is_active, 1) = 1
        WHERE COALESCE(u.is_active, 1) = 1
        GROUP BY u.id, u.role
      `,
    ]);

    const providerMeta = this.currencyService.getProviderMeta();
    const categoryMeta = new Map(
      categories.map((category) => [
        category.id,
        {
          name: category.name,
          icon: category.icon,
          cash_flow_group: category.cash_flow_group,
          isSystem: category.is_system !== false,
          userId: category.user_id,
        },
      ]),
    );
    const walletNames = new Map(
      walletMetadata.map((wallet) => [wallet.id, wallet.name]),
    );
    const walletCurrencyMap = new Map(
      walletMetadata.map((wallet) => [wallet.id, wallet.currency]),
    );
    const convertedBalances = await Promise.all(
      wallets.map((wallet) =>
        this.currencyService.convertAmount(
          wallet.balance,
          wallet.currency,
          targetCurrency,
        ),
      ),
    );
    const totalBalance = convertedBalances.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const walletCount = wallets.length;
    const premiumRate =
      totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0;
    const averageWalletBalance = walletCount ? totalBalance / walletCount : 0;
    const convertedAllTransactions = await this.convertTransactions(
      yearTransactions,
      walletCurrencyMap,
      targetCurrency,
    );
    const convertedYearTransactions = convertedAllTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= startOfYear &&
        transaction.transaction_date < endOfYear,
    );
    const monthTransactionsOriginal = yearTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= startOfMonth &&
        transaction.transaction_date < endOfMonth,
    );
    const overBudgetWallets = budgets.filter((budget) => {
      const spent = monthTransactionsOriginal.reduce((sum, transaction) => {
        const amount = this.toNumber(transaction.amount);

        if (
          transaction.wallet_id === budget.wallet_id &&
          amount < 0 &&
          isNormalCashFlow(
            transaction.category_id
              ? categoryMeta.get(transaction.category_id)
              : null,
          ) &&
          transaction.transaction_date >= budget.start_date &&
          transaction.transaction_date <= budget.end_date
        ) {
          return sum + Math.abs(amount);
        }

        return sum;
      }, 0);

      return spent > this.toNumber(budget.amount);
    }).length;
    const dayTransactions = convertedYearTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= startOfDay &&
        transaction.transaction_date < endOfDay,
    );
    const weekTransactions = convertedYearTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= startOfWeek &&
        transaction.transaction_date < endOfWeek,
    );
    const monthTransactions = convertedYearTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= startOfMonth &&
        transaction.transaction_date < endOfMonth,
    );
    const quarterStart = new Date(
      selectedDate.getFullYear(),
      Math.floor(selectedDate.getMonth() / 3) * 3,
      1,
    );
    const quarterEnd = new Date(quarterStart);
    quarterEnd.setMonth(quarterEnd.getMonth() + 3);
    const quarterTransactions = convertedYearTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= quarterStart &&
        transaction.transaction_date < quarterEnd,
    );
    const selectedPeriodTransactions = convertedAllTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= periodRange.start &&
        transaction.transaction_date < periodRange.end,
    );
    const previousPeriodTransactions =
      selectedPeriod === 'all'
        ? []
        : convertedAllTransactions.filter(
            (transaction) =>
              transaction.transaction_date >= periodRange.previousStart &&
              transaction.transaction_date < periodRange.previousEnd,
          );
    const daySummary = this.summarizeTransactions(
      dayTransactions,
      categoryMeta,
    );
    const weekSummary = this.summarizeTransactions(
      weekTransactions,
      categoryMeta,
    );
    const monthSummary = this.summarizeTransactions(
      monthTransactions,
      categoryMeta,
    );
    const quarterSummary = this.summarizeTransactions(
      quarterTransactions,
      categoryMeta,
    );
    const yearSummary = this.summarizeTransactions(
      convertedYearTransactions,
      categoryMeta,
    );
    const selectedPeriodSummary = this.summarizeTransactions(
      selectedPeriodTransactions,
      categoryMeta,
    );
    const previousPeriodSummary = this.summarizeTransactions(
      previousPeriodTransactions,
      categoryMeta,
    );

    const chartMonthCount =
      selectedDate.getFullYear() === new Date().getFullYear()
        ? new Date().getMonth() + 1
        : 12;
    const chart = monthLabels.slice(0, chartMonthCount).map((label, index) => {
      const transactions = convertedYearTransactions.filter(
        (transaction) => transaction.transaction_date.getMonth() === index,
      );
      const summary = this.summarizeTransactions(transactions, categoryMeta);

      return {
        month: label,
        income: summary.income,
        expense: summary.expense,
      };
    });
    const periodChart = this.buildPeriodChart(
      selectedPeriod,
      periodRange,
      selectedPeriodTransactions,
      categoryMeta,
    );

    const topCategories = selectedPeriodSummary.categoryTotals
      .sort((left, right) => right.total - left.total)
      .slice(0, 8)
      .map((category) => ({
        ...category,
        name: category.name,
      }));
    const systemCategoryTotals = selectedPeriodSummary.categoryTotals.filter(
      (category) => categoryMeta.get(category.categoryId)?.isSystem === true,
    );
    const personalCategoryTotals = selectedPeriodSummary.categoryTotals.filter(
      (category) => {
        const meta = categoryMeta.get(category.categoryId);

        return meta ? !meta.isSystem && meta.userId !== null : false;
      },
    );
    const topPersonalIncomeCategories = personalCategoryTotals
      .filter((category) => category.income > 0)
      .sort((left, right) => right.income - left.income)
      .slice(0, 5);
    const topPersonalExpenseCategories = personalCategoryTotals
      .filter((category) => category.expense > 0)
      .sort((left, right) => right.expense - left.expense)
      .slice(0, 5);
    const topWallets = selectedPeriodSummary.walletTotals
      .sort((left, right) => right.total - left.total)
      .slice(0, 8)
      .map((wallet) => ({
        ...wallet,
        name: walletNames.get(wallet.walletId) ?? `Ví #${wallet.walletId}`,
      }));
    const selectedNormalTransactions = selectedPeriodTransactions.filter(
      (transaction) =>
        isNormalCashFlow(
          transaction.category_id
            ? categoryMeta.get(transaction.category_id)
            : null,
        ),
    );
    const selectedTransactionAmountById = new Map(
      selectedNormalTransactions.map((transaction) => [
        transaction.id,
        Math.abs(transaction.amount),
      ]),
    );
    const selectedTransactionIds = Array.from(
      selectedTransactionAmountById.keys(),
    );
    const transactionTagRows = selectedTransactionIds.length
      ? await this.prisma.$queryRaw<
          Array<{ transaction_id: number; name: string }>
        >`
          SELECT tt.transaction_id, t.name
          FROM transaction_tags tt
          JOIN tags t ON t.id = tt.tag_id
          WHERE tt.transaction_id IN (${Prisma.join(selectedTransactionIds)})
        `
      : [];
    const hotHashtagMap = new Map<
      string,
      { tag: string; total: number; count: number }
    >();

    transactionTagRows.forEach((row) => {
      const tag = row.name.trim();

      if (!tag) {
        return;
      }

      const current = hotHashtagMap.get(tag) ?? {
        tag,
        total: 0,
        count: 0,
      };

      current.total +=
        selectedTransactionAmountById.get(row.transaction_id) ?? 0;
      current.count += 1;
      hotHashtagMap.set(tag, current);
    });
    const hotHashtags = Array.from(hotHashtagMap.values())
      .sort(
        (left, right) => right.count - left.count || right.total - left.total,
      )
      .slice(0, 10);
    const roleDistribution = [
      { name: 'Basic', value: basicUsers },
      { name: 'Premium', value: premiumUsers },
      { name: 'Admin', value: adminUsers },
    ];
    const basicWalletCounts = usersWithWalletCounts
      .filter((user) => user.role === 'BASIC')
      .map((user) => Number(user.wallet_count));
    const premiumWalletCounts = usersWithWalletCounts
      .filter((user) => user.role === 'PREMIUM')
      .map((user) => Number(user.wallet_count));
    const basicAtWalletLimit = basicWalletCounts.filter(
      (count) => count >= 2,
    ).length;
    const basicNoWallet = basicWalletCounts.filter(
      (count) => count === 0,
    ).length;
    const premiumAverageWallets =
      premiumWalletCounts.length > 0
        ? premiumWalletCounts.reduce((sum, count) => sum + count, 0) /
          premiumWalletCounts.length
        : 0;
    const subscriptionStats = {
      basicUsers,
      premiumUsers,
      adminUsers,
      premiumRate,
      basicAtWalletLimit,
      basicNoWallet,
      basicLimitRate:
        basicUsers > 0
          ? Math.round((basicAtWalletLimit / basicUsers) * 100)
          : 0,
      premiumAverageWallets,
      upgradeOpportunityUsers: basicAtWalletLimit,
    };
    const insightSeverity = (
      kind: 'premium' | 'cashflow' | 'alert',
    ): InsightSeverity => {
      if (kind === 'premium') {
        return premiumRate < 35 ? 'warning' : 'success';
      }

      if (kind === 'cashflow') {
        if (monthSummary.expenseToIncomeRate >= 90) {
          return 'danger';
        }

        return monthSummary.expenseToIncomeRate >= 70 ? 'warning' : 'success';
      }

      return negativeWallets > 0 || overBudgetWallets > 0
        ? 'danger'
        : 'success';
    };

    const recentImportantLogs = recentLogs
      .filter((log) => this.isImportantLog(log.action))
      .slice(0, 8);

    return {
      display_currency: targetCurrency,
      exchange_provider: providerMeta.name,
      exchange_provider_docs: providerMeta.docsUrl,
      exchange_attribution_url: providerMeta.attributionUrl,
      total_users: totalUsers,
      premium_users: premiumUsers,
      selected_period: selectedPeriod,
      period_range: {
        start: this.formatDate(periodRange.start),
        end: this.formatDate(new Date(periodRange.end.getTime() - 1)),
      },
      previous_period_range: {
        start: this.formatDate(periodRange.previousStart),
        end: this.formatDate(new Date(periodRange.previousEnd.getTime() - 1)),
      },
      period_summary: selectedPeriodSummary,
      previous_period_summary: previousPeriodSummary,
      comparison: this.compareSummaries(
        selectedPeriodSummary,
        previousPeriodSummary,
      ),
      total_income: selectedPeriodSummary.income,
      total_expense: selectedPeriodSummary.expense,
      negative_wallets: negativeWallets,
      over_budget_wallets: overBudgetWallets,
      summary: {
        totalUsers,
        premiumUsers,
        basicUsers,
        adminUsers,
        totalWallets,
        negativeWallets,
        overBudgetWallets,
        totalCategories,
        totalTransactions,
        totalBalance,
        monthIncome: monthSummary.income,
        monthExpense: monthSummary.expense,
        premiumRate,
        averageWalletBalance,
      },
      chart,
      period_chart: periodChart,
      chart_granularity:
        selectedPeriod === 'day'
          ? 'hour'
          : selectedPeriod === 'week'
            ? 'day'
            : selectedPeriod === 'month'
              ? 'week'
              : selectedPeriod === 'all'
                ? 'year'
                : 'month',
      recentLogs: recentImportantLogs,
      insights: [
        {
          title: 'Gợi ý 1: Premium',
          severity: insightSeverity('premium'),
          message: `Tỷ lệ Premium hiện tại: ${premiumRate}%. ${
            premiumRate < 35
              ? 'Cần tăng thêm để cải thiện doanh thu.'
              : 'Tỷ lệ nâng cấp đang ổn, tiếp tục theo dõi chuyển đổi.'
          }`,
        },
        {
          title: 'Gợi ý 2: Thu/Chi',
          severity: insightSeverity('cashflow'),
          message:
            monthSummary.income > 0
              ? `Chi tháng này chiếm ${monthSummary.expenseToIncomeRate}% thu -> ${
                  monthSummary.expenseToIncomeRate >= 90
                    ? 'cần kiểm tra chi tiêu bất thường.'
                    : 'dòng tiền vẫn trong mức có thể kiểm soát.'
                }`
              : 'Tháng này chưa có thu nhập, cần kiểm tra dữ liệu giao dịch thu.',
        },
        {
          title: 'Gợi ý 3: Cảnh báo',
          severity: insightSeverity('alert'),
          message:
            negativeWallets > 0 || overBudgetWallets > 0
              ? `Có ${negativeWallets} ví đang âm và ${overBudgetWallets} ví vượt hạn mức -> cần cảnh báo người dùng.`
              : 'Không có ví âm hoặc ví vượt hạn mức -> trạng thái ví đang ổn.',
        },
      ],
      sampleInsights: [
        `Tỷ lệ Premium hiện tại: ${premiumRate}%.`,
        `Chi tháng này chiếm ${monthSummary.expenseToIncomeRate}% thu.`,
        `Có ${negativeWallets} ví đang âm và ${overBudgetWallets} ví vượt hạn mức.`,
      ],
      statistics: {
        display_currency: targetCurrency,
        periods: {
          all: selectedPeriod === 'all' ? selectedPeriodSummary : yearSummary,
          day: daySummary,
          week: weekSummary,
          month: monthSummary,
          quarter: quarterSummary,
          year: yearSummary,
        },
        selectedPeriod,
        periodRange: {
          start: this.formatDate(periodRange.start),
          end: this.formatDate(new Date(periodRange.end.getTime() - 1)),
        },
        previousPeriodRange: {
          start: this.formatDate(periodRange.previousStart),
          end: this.formatDate(new Date(periodRange.previousEnd.getTime() - 1)),
        },
        selectedPeriodSummary,
        previousPeriodSummary,
        comparison: this.compareSummaries(
          selectedPeriodSummary,
          previousPeriodSummary,
        ),
        periodChart,
        roleDistribution,
        topCategories,
        systemCategoryTotals,
        personalCategoryTotals,
        topPersonalIncomeCategories,
        topPersonalExpenseCategories,
        topWallets,
        hotHashtags,
        walletHealth: [
          {
            name: 'Ví bình thường',
            value: Math.max(
              totalWallets - negativeWallets - overBudgetWallets,
              0,
            ),
          },
          { name: 'Ví âm', value: negativeWallets },
          { name: 'Vượt hạn mức', value: overBudgetWallets },
        ],
        subscriptionStats,
      },
    };
  }
}
