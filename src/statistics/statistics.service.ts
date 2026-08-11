import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isNormalCashFlow } from '../common/finance/cash-flow-classification';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';

export type StatisticsPeriod = 'all' | 'day' | 'week' | 'month' | 'year';

type WalletRow = {
  id: number;
  currency: string;
};

type RawTransaction = {
  id: number;
  wallet_id: number | null;
  category_id: number | null;
  amount: Prisma.Decimal;
  currency?: string | null;
  converted_amount?: Prisma.Decimal | null;
  converted_currency?: string | null;
  exchange_rate_used?: Prisma.Decimal | null;
  transaction_date: Date;
};

type CategoryMeta = {
  id: number;
  name: string;
  type: string;
  cash_flow_group?: string | null;
  icon: string | null;
};

@Injectable()
export class StatisticsService {
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private getPeriodRange(period: StatisticsPeriod, offset = 0) {
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );

    if (period === 'all') {
      return { start: new Date(1970, 0, 1), end: tomorrow };
    }

    if (period === 'day') {
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offset,
      );
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end: end > tomorrow ? tomorrow : end };
    }

    if (period === 'week') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = start.getDay();
      start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end: end > tomorrow ? tomorrow : end };
    }

    if (period === 'year') {
      const start = new Date(now.getFullYear() + offset, 0, 1);
      const end = new Date(now.getFullYear() + offset + 1, 0, 1);
      return { start, end: end > tomorrow ? tomorrow : end };
    }

    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    return { start, end: end > tomorrow ? tomorrow : end };
  }

  private getBucketLabel(date: Date, period: StatisticsPeriod) {
    if (period === 'day' || period === 'week' || period === 'month') {
      return `${date.getDate()}/${date.getMonth() + 1}`;
    }

    return `T${date.getMonth() + 1}`;
  }

  private async convertTransactionAmount(
    transaction: RawTransaction,
    walletCurrency: string,
    targetCurrency: string,
  ) {
    const target = this.currencyService.normalizeCurrency(targetCurrency);

    if (
      transaction.converted_amount &&
      transaction.converted_currency &&
      this.currencyService.normalizeCurrency(transaction.converted_currency) ===
        target
    ) {
      return Math.abs(Number(transaction.converted_amount));
    }

    const converted = await this.currencyService.convertAmount(
      new Prisma.Decimal(transaction.amount).abs(),
      transaction.currency ?? walletCurrency,
      target,
    );

    return converted.amount;
  }

  async getUserStatistics(userId: number, period: StatisticsPeriod) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { currency_default: true },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const displayCurrency = this.currencyService.normalizeCurrency(
      user.currency_default,
    );
    const wallets = await this.prisma.$queryRaw<WalletRow[]>`
      SELECT id, currency
      FROM wallets
      WHERE user_id = ${userId}
    `;
    const walletIds = wallets.map((wallet) => wallet.id);
    const walletCurrencyMap = new Map(
      wallets.map((wallet) => [wallet.id, wallet.currency]),
    );
    const currentRange = this.getPeriodRange(period);
    const previousRange = this.getPeriodRange(period, -1);
    const yearStart = new Date(currentRange.start.getFullYear(), 0, 1);
    const yearEnd = new Date(currentRange.start.getFullYear() + 1, 0, 1);
    const transactions = walletIds.length
      ? await this.prisma.transactions.findMany({
          where: {
            wallet_id: { in: walletIds },
            transaction_date: {
              gte: previousRange.start,
              lt: currentRange.end,
            },
          },
          select: {
            id: true,
            wallet_id: true,
            category_id: true,
            amount: true,
            currency: true,
            converted_amount: true,
            converted_currency: true,
            exchange_rate_used: true,
            transaction_date: true,
          },
        })
      : [];
    const trendTransactions = walletIds.length
      ? await this.prisma.transactions.findMany({
          where: {
            wallet_id: { in: walletIds },
            transaction_date: {
              gte: yearStart,
              lt: yearEnd,
            },
          },
          select: {
            id: true,
            wallet_id: true,
            category_id: true,
            amount: true,
            currency: true,
            converted_amount: true,
            converted_currency: true,
            exchange_rate_used: true,
            transaction_date: true,
          },
        })
      : [];
    const currentTransactions = transactions.filter(
      (transaction) =>
        transaction.transaction_date >= currentRange.start &&
        transaction.transaction_date < currentRange.end,
    );
    const previousTransactions = transactions.filter(
      (transaction) =>
        transaction.transaction_date >= previousRange.start &&
        transaction.transaction_date < previousRange.end,
    );
    const categoryIds = [...transactions, ...trendTransactions]
      .map((transaction) => transaction.category_id)
      .filter((id): id is number => id !== null);
    const categories = categoryIds.length
      ? await this.prisma.categories.findMany({
          where: { id: { in: [...new Set(categoryIds)] } },
          select: {
            id: true,
            name: true,
            type: true,
            cash_flow_group: true,
            icon: true,
          },
        })
      : [];
    const categoryMap = new Map(
      categories.map((category) => [category.id, category as CategoryMeta]),
    );
    const tagRows = currentTransactions.length
      ? await this.prisma.$queryRaw<
          Array<{ transaction_id: number; name: string }>
        >`
          SELECT tt.transaction_id, t.name
          FROM transaction_tags tt
          INNER JOIN tags t ON t.id = tt.tag_id
          WHERE tt.transaction_id IN (${Prisma.join(currentTransactions.map((item) => item.id))})
          ORDER BY t.name ASC
        `
      : [];
    const tagMap = new Map<number, string[]>();

    tagRows.forEach((row) => {
      tagMap.set(row.transaction_id, [
        ...(tagMap.get(row.transaction_id) ?? []),
        row.name,
      ]);
    });

    const summarize = async (items: RawTransaction[]) => {
      let income = 0;
      let expense = 0;
      let transactionCount = 0;
      let expenseCount = 0;

      for (const item of items) {
        const category = item.category_id
          ? categoryMap.get(item.category_id)
          : null;

        if (!isNormalCashFlow(category)) {
          continue;
        }

        const signedAmount = new Prisma.Decimal(item.amount);
        const amount = await this.convertTransactionAmount(
          item,
          walletCurrencyMap.get(item.wallet_id ?? 0) ?? 'VND',
          displayCurrency,
        );
        transactionCount += 1;

        if (signedAmount.greaterThanOrEqualTo(0)) {
          income += amount;
        } else {
          expense += amount;
          expenseCount += 1;
        }
      }

      return {
        income,
        expense,
        net: income - expense,
        transactionCount,
        expenseCount,
        averageExpense: expenseCount > 0 ? expense / expenseCount : 0,
      };
    };

    const summary = await summarize(currentTransactions);
    const previousSummary = await summarize(previousTransactions);
    const categoryTotals = new Map<
      number,
      { total: number; name: string; icon: string | null }
    >();
    const tagTotals = new Map<string, { total: number; count: number }>();
    const chartTotals = new Map<string, { income: number; expense: number }>();
    const monthlyTrend = new Map<
      string,
      { income: number; expense: number; net: number }
    >();
    let biggestExpense = 0;
    let biggestExpenseCategory: string | null = null;

    const trendMonthCount =
      currentRange.start.getFullYear() === new Date().getFullYear()
        ? new Date().getMonth() + 1
        : 12;
    for (let month = 0; month < trendMonthCount; month += 1) {
      monthlyTrend.set(`T${month + 1}`, { income: 0, expense: 0, net: 0 });
    }

    for (const transaction of trendTransactions) {
      const category = transaction.category_id
        ? categoryMap.get(transaction.category_id)
        : null;

      if (!isNormalCashFlow(category)) {
        continue;
      }

      const signedAmount = new Prisma.Decimal(transaction.amount);
      const amount = await this.convertTransactionAmount(
        transaction,
        walletCurrencyMap.get(transaction.wallet_id ?? 0) ?? 'VND',
        displayCurrency,
      );
      const label = `T${transaction.transaction_date.getMonth() + 1}`;
      const current = monthlyTrend.get(label) ?? {
        income: 0,
        expense: 0,
        net: 0,
      };

      if (signedAmount.greaterThanOrEqualTo(0)) {
        current.income += amount;
        current.net += amount;
      } else {
        current.expense += amount;
        current.net -= amount;
      }

      monthlyTrend.set(label, current);
    }

    for (const transaction of currentTransactions) {
      const category = transaction.category_id
        ? categoryMap.get(transaction.category_id)
        : null;

      if (!isNormalCashFlow(category)) {
        continue;
      }

      const signedAmount = new Prisma.Decimal(transaction.amount);
      const amount = await this.convertTransactionAmount(
        transaction,
        walletCurrencyMap.get(transaction.wallet_id ?? 0) ?? 'VND',
        displayCurrency,
      );
      const label = this.getBucketLabel(transaction.transaction_date, period);
      const chart = chartTotals.get(label) ?? { income: 0, expense: 0 };

      if (signedAmount.greaterThanOrEqualTo(0)) {
        chart.income += amount;
      } else {
        chart.expense += amount;
        if (amount > biggestExpense) {
          biggestExpense = amount;
          biggestExpenseCategory = category?.name ?? null;
        }

        if (category) {
          const current = categoryTotals.get(category.id) ?? {
            total: 0,
            name: category.name,
            icon: category.icon,
          };
          current.total += amount;
          categoryTotals.set(category.id, current);
        }
      }

      chartTotals.set(label, chart);

      for (const tag of tagMap.get(transaction.id) ?? []) {
        const current = tagTotals.get(tag) ?? { total: 0, count: 0 };
        current.total += amount;
        current.count += 1;
        tagTotals.set(tag, current);
      }
    }

    const categoryStats = [...categoryTotals.entries()]
      .map(([categoryId, value]) => ({ categoryId, ...value }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 8);
    const tags = [...tagTotals.entries()]
      .map(([tag, value]) => ({ tag, ...value }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 8);

    return {
      period,
      display_currency: displayCurrency,
      range: currentRange,
      previous_range: previousRange,
      summary: {
        ...summary,
        biggestExpense,
        biggestExpenseCategory,
      },
      previous_summary: previousSummary,
      comparison: {
        expense_change_percent:
          previousSummary.expense > 0
            ? Math.round(
                ((summary.expense - previousSummary.expense) /
                  previousSummary.expense) *
                  100,
              )
            : null,
      },
      chart: [...chartTotals.entries()].map(([label, value]) => ({
        label,
        ...value,
      })),
      monthly_trend: [...monthlyTrend.entries()].map(([label, value]) => ({
        label,
        ...value,
      })),
      categories: categoryStats,
      top_categories: categoryStats,
      tags,
      hot_hashtags: tags,
    };
  }
}
