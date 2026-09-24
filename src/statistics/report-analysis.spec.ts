import { analyzeReportRows } from './report-analysis';

it('groups only expenses by category and reconciles monthly totals', () => {
  const result = analyzeReportRows([
    {
      category: 'Lương',
      type: 'Thu',
      amount: 1000,
      date: new Date(2026, 0, 1),
    },
    {
      category: 'Ăn uống',
      type: 'Chi',
      amount: 100,
      date: new Date(2026, 0, 2),
    },
    {
      category: 'Ăn uống',
      type: 'Chi',
      amount: 50,
      date: new Date(2026, 1, 2),
    },
    {
      category: 'Di chuyển',
      type: 'Chi',
      amount: 50,
      date: new Date(2026, 1, 3),
    },
  ]);
  expect(result.categories).toEqual([
    { category: 'Ăn uống', amount: 150, count: 2, percent: 75 },
    { category: 'Di chuyển', amount: 50, count: 1, percent: 25 },
  ]);
  expect(result.months.map((row) => row.net)).toEqual([900, -100]);
});

it('handles an empty period without invalid percentages', () => {
  expect(analyzeReportRows([])).toEqual({ categories: [], months: [] });
});
