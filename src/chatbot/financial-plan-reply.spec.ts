import { buildFinancialPlanReply } from './financial-plan-reply';
import type { FinancialPlansService } from '../financial-plans/financial-plans.service';

type Overview = Awaited<ReturnType<FinancialPlansService['getOverview']>>;
const overview = {
  cashflow_plans: [
    {
      currency: 'VND',
      forecast: [{ projected_net: -100000 }],
      summary: { status: 'RISK' },
      spending_actions: [],
    },
  ],
  savings_plans: [],
} as unknown as Overview;
describe('guided financial plans', () => {
  const withMonthlyGoal = (futureContribution: number) =>
    ({
      cashflow_plans: [
        {
          currency: 'VND',
          forecast: [
            { month: '2026-09', projected_net: 1000000 },
            { month: '2026-10', projected_net: 2000000 },
          ],
          summary: { status: 'STABLE' },
          spending_actions: [],
        },
      ],
      savings_plans: [
        {
          name: 'Học phí',
          currency: 'VND',
          remaining_amount: futureContribution,
          roadmap: {
            status: 'SCHEDULED',
            next_contribution: 0,
            next_due_date: '2026-09-30',
            schedule: [
              { due_date: '2026-09-30', amount: 0 },
              { due_date: '2026-10-31', amount: futureContribution },
            ],
          },
        },
      ],
    }) as unknown as Overview;

  it('uses future installments and the lowest monthly surplus for a recurring contribution', () => {
    const reply = buildFinancialPlanReply(
      withMonthlyGoal(1800000),
      'Lập quỹ dự phòng trong 2 tháng',
    );
    expect(reply).toContain('100.000 VND/tháng');
    expect(reply).toContain('tổng 200.000 VND');
  });

  it('warns about a later deficit even when average cash flow is positive', () => {
    const reply = buildFinancialPlanReply(
      withMonthlyGoal(2500000),
      'Gợi ý 3 kế hoạch tài chính trong 2 tháng',
    );
    expect(reply).toContain('thiếu 500.000 VND');
    expect(reply).toContain('Có tháng thiếu tiền');
    expect(reply).not.toContain('Kịch bản thử: dành');
  });

  it('does not reserve extra money before overdue goals are rescheduled', () => {
    const data = withMonthlyGoal(100000);
    data.savings_plans[0].roadmap.status = 'OVERDUE';
    const reply = buildFinancialPlanReply(
      data,
      'Lập quỹ dự phòng trong 2 tháng',
    );
    expect(reply).toContain('Cập nhật lịch góp');
    expect(reply).not.toContain('Kịch bản thử: dành');
  });
  it('provides three concrete paths and does not assign emergency savings from negative cash flow', () => {
    const reply = buildFinancialPlanReply(
      overview,
      'Gợi ý 3 kế hoạch tài chính',
    );
    expect(reply).toContain('1. Giảm chi');
    expect(reply).toContain('2. Góp theo mục tiêu');
    expect(reply).toContain('3. Tạo một khoản dự phòng');
    expect(reply).toContain('Chưa có phần dư dự báo');
    expect(reply).not.toContain('Kịch bản thử: dành');
  });
  it('routes custom financial questions to the model instead of silently replacing their constraints', () => {
    expect(
      buildFinancialPlanReply(
        overview,
        'Lập kế hoạch mua nhà 2 tỷ trong 5 năm',
      ),
    ).toBeNull();
    expect(
      buildFinancialPlanReply(overview, 'Lập kế hoạch giảm chi trong 4 tháng'),
    ).toContain('Kế hoạch 4 tháng');
  });
  it('does not claim surplus for insufficient data', () => {
    const empty = {
      ...overview,
      cashflow_plans: [
        {
          ...overview.cashflow_plans[0],
          summary: {
            ...overview.cashflow_plans[0].summary,
            status: 'INSUFFICIENT_DATA',
          },
        },
      ],
    } as Overview;
    expect(
      buildFinancialPlanReply(empty, 'Lập quỹ dự phòng trong 2 tháng'),
    ).toContain('Dữ liệu còn ít');
  });
});
