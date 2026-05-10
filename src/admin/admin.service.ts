import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private readonly importantLogKeywords = [
    'dang nhap',
    'dang xuat',
    'them',
    'tao',
    'cap nhat',
    'sua',
    'xoa',
    'doi mat khau',
    'upload',
  ];

  private toNumber(value: Prisma.Decimal | number | null | undefined) {
    if (value instanceof Prisma.Decimal) {
      return value.toNumber();
    }

    return Number(value || 0);
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
              ? new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
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
  ): TrendPoint {
    const summary = this.summarizeTransactions(
      this.filterTransactionsByRange(transactions, start, end),
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
  ) {
    if (period === 'all') {
      const years = new Set<number>();

      transactions.forEach((transaction) => {
        years.add(transaction.transaction_date.getFullYear());
      });

      const currentYear = new Date().getFullYear();
      const sortedYears = Array.from(years.size ? years : new Set([currentYear])).sort(
        (left, right) => left - right,
      );

      return sortedYears.map((year) => {
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        return this.buildTrendPoint(`${year}`, start, end, transactions);
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
        );
      });
    }

    if (period === 'week' || period === 'month') {
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
          ),
        );
        cursor.setDate(cursor.getDate() + 1);
      }

      return points;
    }

    const monthCount = period === 'quarter' ? 3 : 12;

    return Array.from({ length: monthCount }, (_, index) => {
      const start = new Date(range.start.getFullYear(), range.start.getMonth() + index, 1);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      return this.buildTrendPoint(
        `T${start.getMonth() + 1}/${start.getFullYear()}`,
        start,
        end,
        transactions,
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
      transactionCount: percent(current.transactionCount, previous.transactionCount),
    };
  }

  private normalizeLogText(value?: string | null) {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private isImportantLog(action?: string | null) {
    const normalized = this.normalizeLogText(action);

    if (!normalized) {
      return false;
    }

    return this.importantLogKeywords.some((keyword) =>
      normalized.includes(keyword),
    );
  }

  private formatKnownLogAction(action?: string | null) {
    if (!action) {
      return action;
    }

    return action
      .replaceAll('Nguoi dung dang nhap he thong', 'Người dùng đăng nhập hệ thống')
      .replaceAll('Nguoi dung dang xuat he thong', 'Người dùng đăng xuất hệ thống')
      .replaceAll('Cap nhat ho so nguoi dung', 'Cập nhật hồ sơ người dùng')
      .replaceAll('Nguoi dung doi mat khau', 'Người dùng đổi mật khẩu')
      .replaceAll('Tao nguoi dung', 'Tạo người dùng')
      .replaceAll('Admin cap nhat nguoi dung', 'Admin cập nhật người dùng')
      .replaceAll('Admin xoa nguoi dung', 'Admin vô hiệu hóa người dùng');
  }

  private summarizeTransactions(
    transactions: ConvertedTransaction[],
  ) {
    const incomeTransactions = transactions.filter((transaction) => transaction.amount >= 0);
    const expenseTransactions = transactions.filter((transaction) => transaction.amount < 0);
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

    transactions.forEach((transaction) => {
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
      transactionCount: transactions.length,
      incomeCount: incomeTransactions.length,
      expenseCount: expenseTransactions.length,
      averageTransaction: transactions.length
        ? (income + expense) / transactions.length
        : 0,
      expenseToIncomeRate:
        income > 0 ? Math.round((expense / income) * 100) : 0,
      biggestIncome,
      biggestExpense,
      categoryTotals: Array.from(categoryTotals.entries()).map(
        ([categoryId, totals]) => ({
          categoryId,
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
      amount: Prisma.Decimal;
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
        const absoluteAmount = await this.currencyService.convertAmount(
          Math.abs(signedAmount),
          walletCurrency,
          targetCurrency,
        );

        return {
          ...transaction,
          amount: signedAmount >= 0 ? absoluteAmount.amount : -absoluteAmount.amount,
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

  async getLogs() {
    const logs = await this.prisma.admin_logs.findMany({
      where: {
        NOT: [
          { action: { contains: 'xem trang thong ke tong quan' } },
          { action: { contains: 'xem dashboard' } },
          { action: { contains: 'refresh' } },
          { action: { contains: 'chuyen tab' } },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });

    return logs
      .filter((log) => this.isImportantLog(log.action))
      .slice(0, 50)
      .map((log) => ({
        ...log,
        action: this.formatKnownLogAction(log.action),
      }));
  }

  async getDashboard(adminUserId: number, date?: string, period?: string) {
    const targetCurrency = await this.prisma.users
      .findUnique({
        where: { id: adminUserId },
        select: { currency_default: true },
      })
      .then((user) => this.currencyService.normalizeCurrency(user?.currency_default));

    const selectedPeriod = this.normalizePeriod(period);
    const selectedDate = this.getDateFromQuery(date);
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
      yearTransactions,
      recentLogs,
      categories,
    ] = await Promise.all([
      this.prisma.users.count(),
      this.prisma.users.count({ where: { role: 'PREMIUM' } }),
      this.prisma.users.count({ where: { role: 'BASIC' } }),
      this.prisma.users.count({ where: { role: 'ADMIN' } }),
      this.prisma.wallets.count(),
      this.prisma.wallets.count({
        where: {
          balance: {
            lt: 0,
          },
        },
      }),
      this.prisma.categories.count(),
      this.prisma.transactions.count(),
      this.prisma.$queryRaw<
        Array<{
          id: number;
          name: string;
          currency: string;
          balance: Prisma.Decimal | null;
          budget_limit: Prisma.Decimal | null;
        }>
      >`
        SELECT id, name, currency, balance, budget_limit
        FROM wallets
      `,
      this.prisma.transactions.findMany({
        where: {
          transaction_date: {
            gte: transactionQueryStart,
            lt: transactionQueryEnd,
          },
        },
        select: {
          amount: true,
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
        },
      }),
    ]);

    const providerMeta = this.currencyService.getProviderMeta();
    const categoryNames = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    const walletNames = new Map(wallets.map((wallet) => [wallet.id, wallet.name]));
    const walletCurrencyMap = new Map(
      wallets.map((wallet) => [wallet.id, wallet.currency]),
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
    const monthlyExpenseByWallet = new Map<number, number>();

    monthTransactionsOriginal.forEach((transaction) => {
      const amount = this.toNumber(transaction.amount);

      if (transaction.wallet_id && amount < 0) {
        monthlyExpenseByWallet.set(
          transaction.wallet_id,
          (monthlyExpenseByWallet.get(transaction.wallet_id) ?? 0) + Math.abs(amount),
        );
      }
    });

    const overBudgetWallets = wallets.filter((wallet) => {
      const budgetLimit = this.toNumber(wallet.budget_limit);
      return (
        budgetLimit > 0 &&
        (monthlyExpenseByWallet.get(wallet.id) ?? 0) > budgetLimit
      );
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
    const daySummary = this.summarizeTransactions(dayTransactions);
    const weekSummary = this.summarizeTransactions(weekTransactions);
    const monthSummary = this.summarizeTransactions(monthTransactions);
    const quarterSummary = this.summarizeTransactions(quarterTransactions);
    const yearSummary = this.summarizeTransactions(convertedYearTransactions);
    const selectedPeriodSummary = this.summarizeTransactions(selectedPeriodTransactions);
    const previousPeriodSummary = this.summarizeTransactions(previousPeriodTransactions);

    const chart = monthLabels.map((label, index) => {
      const transactions = convertedYearTransactions.filter(
        (transaction) => transaction.transaction_date.getMonth() === index,
      );
      const summary = this.summarizeTransactions(transactions);

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
    );

    const topCategories = selectedPeriodSummary.categoryTotals
      .sort((left, right) => right.total - left.total)
      .slice(0, 8)
      .map((category) => ({
        ...category,
        name: categoryNames.get(category.categoryId) ?? `Danh mục #${category.categoryId}`,
      }));
    const topWallets = selectedPeriodSummary.walletTotals
      .sort((left, right) => right.total - left.total)
      .slice(0, 8)
      .map((wallet) => ({
        ...wallet,
        name: walletNames.get(wallet.walletId) ?? `Ví #${wallet.walletId}`,
      }));
    const roleDistribution = [
      { name: 'Basic', value: basicUsers },
      { name: 'Premium', value: premiumUsers },
      { name: 'Admin', value: adminUsers },
    ];
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
      comparison: this.compareSummaries(selectedPeriodSummary, previousPeriodSummary),
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
          : selectedPeriod === 'week' || selectedPeriod === 'month'
            ? 'day'
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
        comparison: this.compareSummaries(selectedPeriodSummary, previousPeriodSummary),
        periodChart,
        roleDistribution,
        topCategories,
        topWallets,
        walletHealth: [
          {
            name: 'Ví ổn',
            value: Math.max(totalWallets - negativeWallets - overBudgetWallets, 0),
          },
          { name: 'Ví âm', value: negativeWallets },
          { name: 'Vượt hạn mức', value: overBudgetWallets },
        ],
      },
    };
  }
}
