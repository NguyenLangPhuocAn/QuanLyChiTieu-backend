import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SavingsService } from '../savings/savings.service';
import { buildSpendingActions } from './spending-actions';
import { buildSavingsRoadmap } from '../savings/savings-roadmap';
import {
  buildCashflowForecast,
  type HistoricalCashflowPoint,
} from './cashflow-forecast';

type MonthlyCashflowRow = {
  month: string;
  currency: string;
  income: Prisma.Decimal | number;
  expense: Prisma.Decimal | number;
  transaction_count: bigint | number;
};

const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const monthStart = (date: Date, offset = 0) =>
  new Date(date.getFullYear(), date.getMonth() + offset, 1, 0, 0, 0, 0);

@Injectable()
export class FinancialPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly savingsService: SavingsService,
  ) {}

  private savingsStatus(
    roadmap: ReturnType<typeof buildSavingsRoadmap>,
    now = new Date(),
  ) {
    const contributedThisMonth = roadmap.contributed_this_month;
    // The remaining installment and payments already made belong to one
    // monthly target. Do not recalculate status from remaining/months again.
    const monthlyTarget = Math.max(
      0,
      (roadmap.next_contribution ?? 0) + contributedThisMonth,
    );
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const expectedToDate =
      (monthlyTarget * Math.max(0, now.getUTCDate() - 1)) / daysInMonth;

    const status =
      roadmap.status === 'COMPLETE'
        ? 'ON_TRACK'
        : roadmap.status === 'NO_DEADLINE'
          ? 'NO_DEADLINE'
          : roadmap.status === 'OVERDUE'
            ? 'OVERDUE'
            : contributedThisMonth + monthlyTarget * 0.05 < expectedToDate
              ? 'BEHIND'
              : 'ON_TRACK';

    return {
      contributed_this_month: Math.max(0, contributedThisMonth),
      expected_by_today: Math.round(expectedToDate * 100) / 100,
      monthly_gap: roadmap.next_contribution ?? 0,
      status,
    } as const;
  }

  async getOverview(userId: number, referenceDate = new Date()) {
    const user = await this.prisma.users.findFirst({
      where: { id: userId, deleted_at: null },
      select: { currency_default: true },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const historyMonths = 4;
    const forecastMonths = 4;
    const historyStart = monthStart(referenceDate, -historyMonths);
    const historyEnd = monthStart(referenceDate);
    const rows = await this.prisma.$queryRaw<MonthlyCashflowRow[]>(Prisma.sql`
      SELECT
        DATE_FORMAT(t.transaction_date, '%Y-%m') AS month,
        COALESCE(t.currency, w.currency, ${user.currency_default ?? 'VND'}) AS currency,
        SUM(CASE WHEN c.type = 'INCOME' THEN ABS(t.amount) ELSE 0 END) AS income,
        SUM(CASE WHEN c.type = 'EXPENSE' THEN ABS(t.amount) ELSE 0 END) AS expense,
        COUNT(t.id) AS transaction_count
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id AND w.user_id = ${userId}
      INNER JOIN categories c ON c.id = t.category_id
      WHERE t.transaction_date >= ${historyStart}
        AND t.transaction_date < ${historyEnd}
        AND c.cash_flow_group = 'NORMAL'
      GROUP BY month, currency
      ORDER BY month ASC, currency ASC
    `);

    const categoryRows = await this.prisma.$queryRaw<
      Array<{
        category_id: number;
        category: string;
        currency: string;
        amount: Prisma.Decimal | number;
      }>
    >(Prisma.sql`
      SELECT c.id AS category_id, c.name AS category,
        COALESCE(t.currency, w.currency, ${user.currency_default ?? 'VND'}) AS currency,
        SUM(ABS(t.amount)) AS amount
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id AND w.user_id = ${userId}
      INNER JOIN categories c ON c.id = t.category_id
      WHERE t.transaction_date >= ${historyStart} AND t.transaction_date < ${historyEnd}
        AND c.type = 'EXPENSE' AND c.cash_flow_group = 'NORMAL'
      GROUP BY c.id, c.name, currency
    `);

    const goals = await this.savingsService.findAll(userId);
    const currencies = new Set(
      rows.map((row) => row.currency || user.currency_default || 'VND'),
    );
    goals
      .filter((goal) => goal.status === 'ACTIVE')
      .forEach((goal) => currencies.add(goal.wallet_currency));
    if (!currencies.size) currencies.add(user.currency_default || 'VND');

    const cashflowPlans = [...currencies].map((currency) => {
      const pointsByMonth = new Map(
        rows
          .filter((row) => row.currency === currency)
          .map((row) => [row.month, row]),
      );
      const history: HistoricalCashflowPoint[] = Array.from(
        { length: historyMonths },
        (_item, index) => {
          const month = monthKey(
            monthStart(referenceDate, -historyMonths + index),
          );
          const row = pointsByMonth.get(month);
          return {
            month,
            income: Number(row?.income ?? 0),
            expense: Number(row?.expense ?? 0),
            transaction_count: Number(row?.transaction_count ?? 0),
          };
        },
      );
      return {
        currency,
        ...buildCashflowForecast(history, forecastMonths),
        spending_actions: buildSpendingActions(
          categoryRows
            .filter((row) => row.currency === currency)
            .map((row) => ({ ...row, amount: Number(row.amount) })),
          historyMonths,
        ),
      };
    });

    const savingsPlans = goals
      .filter((goal) => goal.status === 'ACTIVE')
      .map((goal) => {
        const roadmap = buildSavingsRoadmap(goal, referenceDate);
        return {
          id: goal.id,
          name: goal.name,
          wallet_id: goal.wallet_id,
          currency: goal.wallet_currency,
          target_amount: goal.target_amount,
          current_amount: goal.current_amount,
          remaining_amount: goal.remaining_amount,
          progress_percent: goal.progress_percent,
          suggested_monthly: goal.suggested_monthly,
          roadmap,
          target_date: goal.target_date,
          ...this.savingsStatus(roadmap, referenceDate),
        };
      });

    return {
      generated_at: new Date().toISOString(),
      methodology: {
        history_months: historyMonths,
        forecast_months: forecastMonths,
        excludes_internal_transfers: true,
        note: 'Dự báo dùng trung bình có trọng số và xu hướng giảm dần; đây là ước tính, không phải số tiền thực tế.',
      },
      cashflow_plans: cashflowPlans,
      savings_plans: savingsPlans,
    };
  }
}
