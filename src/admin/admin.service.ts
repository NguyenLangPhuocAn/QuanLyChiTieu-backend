import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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

    const parsed = new Date(`${date}T00:00:00`);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Ngày thống kê không hợp lệ');
    }

    return parsed;
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

  private summarizeTransactions(
    transactions: Array<{
      amount: Prisma.Decimal;
      transaction_date: Date;
      category_id?: number | null;
      wallet_id?: number | null;
    }>,
  ) {
    const incomeTransactions = transactions.filter((transaction) =>
      new Prisma.Decimal(transaction.amount).greaterThanOrEqualTo(0),
    );
    const expenseTransactions = transactions.filter((transaction) =>
      new Prisma.Decimal(transaction.amount).lessThan(0),
    );
    const income = incomeTransactions.reduce(
      (sum, transaction) => sum + this.toNumber(transaction.amount),
      0,
    );
    const expense = expenseTransactions.reduce(
      (sum, transaction) => sum + Math.abs(this.toNumber(transaction.amount)),
      0,
    );
    const categoryTotals = new Map<
      number,
      { income: number; expense: number; total: number }
    >();
    const walletTotals = new Map<number, number>();

    transactions.forEach((transaction) => {
      const amount = this.toNumber(transaction.amount);

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
      (max, transaction) => Math.max(max, this.toNumber(transaction.amount)),
      0,
    );
    const biggestExpense = expenseTransactions.reduce(
      (max, transaction) =>
        Math.max(max, Math.abs(this.toNumber(transaction.amount))),
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
          { action: { contains: 'xem trang thống kê tổng quan' } },
          { action: { contains: 'xem dashboard' } },
          { action: { contains: 'refresh' } },
          { action: { contains: 'chuyển tab' } },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    return logs.filter((log) => this.isImportantLog(log.action)).slice(0, 50);
  }

  async getDashboard(date?: string) {
    const selectedDate = this.getDateFromQuery(date);
    const startOfDay = this.getStartOfDay(selectedDate);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const startOfWeek = this.getStartOfWeek(selectedDate);
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

    const [
      totalUsers,
      premiumUsers,
      basicUsers,
      adminUsers,
      totalWallets,
      negativeWallets,
      totalCategories,
      totalTransactions,
      totalBalance,
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
      this.prisma.wallets.aggregate({ _sum: { balance: true } }),
      this.prisma.wallets.findMany({
        select: {
          id: true,
          name: true,
          balance: true,
          budget_limit: true,
        },
      }),
      this.prisma.transactions.findMany({
        where: {
          transaction_date: {
            gte: startOfYear,
            lt: endOfYear,
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

    const categoryNames = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    const walletNames = new Map(
      wallets.map((wallet) => [wallet.id, wallet.name]),
    );
    const walletCount = wallets.length;
    const premiumRate =
      totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0;
    const averageWalletBalance = walletCount
      ? wallets.reduce(
          (sum, wallet) => sum + this.toNumber(wallet.balance),
          0,
        ) / walletCount
      : 0;
    const monthTransactions = yearTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= startOfMonth &&
        transaction.transaction_date < endOfMonth,
    );
    const monthlyExpenseByWallet = new Map<number, number>();

    monthTransactions.forEach((transaction) => {
      const amount = this.toNumber(transaction.amount);

      if (transaction.wallet_id && amount < 0) {
        monthlyExpenseByWallet.set(
          transaction.wallet_id,
          (monthlyExpenseByWallet.get(transaction.wallet_id) ?? 0) +
            Math.abs(amount),
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
    const dayTransactions = yearTransactions.filter(
      (transaction) =>
        transaction.transaction_date >= startOfDay &&
        transaction.transaction_date < endOfDay,
    );
    const weekTransactions = yearTransactions.filter(
      (transaction) => transaction.transaction_date >= startOfWeek,
    );
    const daySummary = this.summarizeTransactions(dayTransactions);
    const weekSummary = this.summarizeTransactions(weekTransactions);
    const monthSummary = this.summarizeTransactions(monthTransactions);
    const yearSummary = this.summarizeTransactions(yearTransactions);

    const chart = monthLabels.map((label, index) => {
      const transactions = yearTransactions.filter(
        (transaction) => transaction.transaction_date.getMonth() === index,
      );
      const summary = this.summarizeTransactions(transactions);

      return {
        month: label,
        income: summary.income,
        expense: summary.expense,
      };
    });

    const topCategories = yearSummary.categoryTotals
      .sort((left, right) => right.total - left.total)
      .slice(0, 8)
      .map((category) => ({
        ...category,
        name:
          categoryNames.get(category.categoryId) ??
          `Danh mục #${category.categoryId}`,
      }));
    const topWallets = yearSummary.walletTotals
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
      total_users: totalUsers,
      premium_users: premiumUsers,
      total_income: monthSummary.income,
      total_expense: monthSummary.expense,
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
        totalBalance: this.toNumber(totalBalance._sum.balance),
        monthIncome: monthSummary.income,
        monthExpense: monthSummary.expense,
        premiumRate,
        averageWalletBalance,
      },
      chart,
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
              ? `Chi tháng này chiếm ${monthSummary.expenseToIncomeRate}% thu → ${
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
              ? `Có ${negativeWallets} ví đang âm và ${overBudgetWallets} ví vượt hạn mức → cần cảnh báo người dùng.`
              : 'Không có ví âm hoặc ví vượt hạn mức → trạng thái ví đang ổn.',
        },
      ],
      sampleInsights: [
        `Tỷ lệ Premium hiện tại: ${premiumRate}%.`,
        `Chi tháng này chiếm ${monthSummary.expenseToIncomeRate}% thu.`,
        `Có ${negativeWallets} ví đang âm và ${overBudgetWallets} ví vượt hạn mức.`,
      ],
      statistics: {
        periods: {
          day: daySummary,
          week: weekSummary,
          month: monthSummary,
          year: yearSummary,
        },
        roleDistribution,
        topCategories,
        topWallets,
        walletHealth: [
          {
            name: 'Ví ổn',
            value: Math.max(
              totalWallets - negativeWallets - overBudgetWallets,
              0,
            ),
          },
          { name: 'Ví âm', value: negativeWallets },
          { name: 'Vượt hạn mức', value: overBudgetWallets },
        ],
      },
    };
  }
}
