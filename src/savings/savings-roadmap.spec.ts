import { buildSavingsRoadmap } from './savings-roadmap';

const now = new Date('2026-09-16T12:00:00Z');
describe('savings roadmap', () => {
  it('distributes only the remaining balance and includes contributions already made this month once', () => {
    const roadmap = buildSavingsRoadmap(
      {
        target_amount: 1000,
        current_amount: 400,
        target_date: '2026-11-15',
        entries: [
          { type: 'CONTRIBUTION', amount: 100, entry_date: '2026-09-05' },
          { type: 'CONTRIBUTION', amount: 400, entry_date: '2026-08-05' },
          { type: 'WITHDRAWAL', amount: 100, entry_date: '2026-08-15' },
        ],
      },
      now,
    );
    expect(roadmap.next_contribution).toBe(133.34);
    expect(roadmap.contributed_this_month).toBe(100);
    expect(roadmap.recent_monthly_contribution).toBe(100);
    expect(roadmap.schedule.map((row) => row.amount)).toEqual([
      133.34, 233.33, 233.33,
    ]);
    expect(roadmap.schedule.at(-1)).toEqual({
      due_date: '2026-11-15',
      amount: 233.33,
      target_balance: 1000,
    });
  });
  it('does not ask for another current-month payment after the installment is paid', () => {
    const roadmap = buildSavingsRoadmap(
      {
        target_amount: 1000,
        current_amount: 533.34,
        target_date: '2026-11-15',
        entries: [
          { type: 'CONTRIBUTION', amount: 233.34, entry_date: '2026-09-16' },
        ],
      },
      now,
    );
    expect(roadmap.next_contribution).toBe(0);
    expect(roadmap.schedule.map((row) => row.amount)).toEqual([
      0, 233.33, 233.33,
    ]);
  });
  it('handles today, missing deadlines, overdue and completed goals without a fake zero contribution recommendation', () => {
    const goal = { target_amount: 100, current_amount: 20, entries: [] };
    expect(buildSavingsRoadmap(goal, now).next_contribution).toBeNull();
    expect(
      buildSavingsRoadmap({ ...goal, target_date: '2026-09-15' }, now).status,
    ).toBe('OVERDUE');
    expect(
      buildSavingsRoadmap({ ...goal, target_date: '2026-09-16' }, now)
        .next_contribution,
    ).toBe(80);
    expect(
      buildSavingsRoadmap({ ...goal, status: 'COMPLETED' }, now).schedule,
    ).toEqual([]);
  });
  it('keeps rounding residuals in the final installment and handles a year boundary', () => {
    const result = buildSavingsRoadmap(
      {
        target_amount: 100,
        current_amount: 0,
        target_date: '2027-02-28',
        entries: [],
      },
      new Date('2026-12-31T12:00:00Z'),
    );
    expect(result.schedule.map((row) => row.amount)).toEqual([
      33.34, 33.33, 33.33,
    ]);
    expect(result.schedule[0].due_date).toBe('2026-12-31');
    expect(result.schedule.at(-1)?.target_balance).toBe(100);
  });
});
