import { PrismaService } from '../prisma/prisma.service';
import { SavingsService } from '../savings/savings.service';
import { FinancialPlansService } from './financial-plans.service';

describe('FinancialPlansService', () => {
  it.each([
    {
      deadline: '2026-09-20',
      current: 20,
      expected: 'BEHIND',
      roadmapStatus: 'SCHEDULED',
    },
    {
      deadline: '2026-09-19',
      current: 20,
      expected: 'OVERDUE',
      roadmapStatus: 'OVERDUE',
    },
    {
      deadline: '2026-09-19',
      current: 100,
      expected: 'ON_TRACK',
      roadmapStatus: 'COMPLETE',
    },
  ])(
    'keeps status consistent with the roadmap for $deadline and saved $current',
    async ({ deadline, current, expected, roadmapStatus }) => {
      const prisma = {
        users: {
          findFirst: jest.fn().mockResolvedValue({ currency_default: 'USD' }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService;
      const savings = {
        findAll: jest.fn().mockResolvedValue([
          {
            id: 1,
            status: 'ACTIVE',
            wallet_currency: 'USD',
            target_amount: 100,
            current_amount: current,
            remaining_amount: 100 - current,
            suggested_monthly: 100 - current,
            target_date: new Date(`${deadline}T00:00:00Z`),
            entries: [],
          },
        ]),
      } as unknown as SavingsService;
      const result = await new FinancialPlansService(
        prisma,
        savings,
      ).getOverview(7, new Date('2026-09-20T15:00:00Z'));
      expect(result.savings_plans[0].status).toBe(expected);
      expect(result.savings_plans[0].roadmap.status).toBe(roadmapStatus);
    },
  );

  it('keeps a savings goal as its own plan and detects slow monthly progress', async () => {
    const prisma = {
      users: {
        findFirst: jest.fn().mockResolvedValue({ currency_default: 'VND' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const savings = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 4,
          status: 'ACTIVE',
          name: 'Mua laptop',
          wallet_id: 9,
          wallet_currency: 'VND',
          target_amount: 12_000_000,
          current_amount: 2_000_000,
          remaining_amount: 10_000_000,
          progress_percent: 17,
          suggested_monthly: 1_000_000,
          target_date: new Date('2027-06-01T00:00:00.000Z'),
          entries: [
            {
              type: 'CONTRIBUTION',
              amount: 100_000,
              entry_date: new Date('2026-09-10T00:00:00.000Z'),
            },
          ],
        },
      ]),
    } as unknown as SavingsService;
    const service = new FinancialPlansService(prisma, savings);

    const result = await service.getOverview(
      7,
      new Date('2026-09-20T08:00:00.000Z'),
    );

    expect(result.methodology.excludes_internal_transfers).toBe(true);
    expect(result.cashflow_plans[0].history).toHaveLength(4);
    expect(result.cashflow_plans[0].forecast).toHaveLength(4);
    expect(result.savings_plans[0]).toMatchObject({
      id: 4,
      status: 'BEHIND',
      contributed_this_month: 100_000,
      monthly_gap: 910_000,
    });
  });
});
