import { buildCashflowForecast } from './cashflow-forecast';

describe('buildCashflowForecast', () => {
  it('projects four months without treating transfers as cash flow input', () => {
    const result = buildCashflowForecast(
      [
        {
          month: '2026-05',
          income: 10_000,
          expense: 6_000,
          transaction_count: 5,
        },
        {
          month: '2026-06',
          income: 10_000,
          expense: 6_500,
          transaction_count: 5,
        },
        {
          month: '2026-07',
          income: 10_000,
          expense: 7_000,
          transaction_count: 5,
        },
        {
          month: '2026-08',
          income: 10_000,
          expense: 7_500,
          transaction_count: 5,
        },
      ],
      4,
    );

    expect(result.forecast).toHaveLength(4);
    expect(result.forecast[0].month).toBe('2026-09');
    expect(result.forecast[3].month).toBe('2026-12');
    expect(result.summary.transaction_count).toBe(20);
    expect(result.summary.status).toBe('STABLE');
    expect(result.summary.confidence).toBe('HIGH');
  });

  it('flags projected expenses above projected income', () => {
    const result = buildCashflowForecast([
      { month: '2026-05', income: 5_000, expense: 7_000, transaction_count: 4 },
      { month: '2026-06', income: 5_000, expense: 7_500, transaction_count: 4 },
      { month: '2026-07', income: 5_000, expense: 8_000, transaction_count: 4 },
      { month: '2026-08', income: 5_000, expense: 8_500, transaction_count: 4 },
    ]);

    expect(result.summary.status).toBe('RISK');
    expect(result.summary.forecast_average_net).toBeLessThan(0);
  });

  it('does not overstate confidence when history is sparse', () => {
    const result = buildCashflowForecast([
      { month: '2026-05', income: 0, expense: 0, transaction_count: 0 },
      { month: '2026-06', income: 0, expense: 0, transaction_count: 0 },
      { month: '2026-07', income: 3_000, expense: 1_000, transaction_count: 2 },
      { month: '2026-08', income: 0, expense: 0, transaction_count: 0 },
    ]);

    expect(result.summary.status).toBe('INSUFFICIENT_DATA');
    expect(result.summary.confidence).toBe('LOW');
  });
});
