import { buildSpendingActions } from './spending-actions';

describe('spending actions', () => {
  it.each(['Điện thoại', 'ĐIỆN THOẠI', '  ĐIỆN   THOẠI  '])(
    'recognizes %s consistently',
    (category) => {
      expect(
        buildSpendingActions(
          [{ category_id: 1, category, amount: 400000 }],
          4,
        )[0],
      ).toMatchObject({ reduction_percent: 5, monthly_reduction: 5000 });
    },
  );
  it('uses the full history window, preserves essential costs and prioritizes reducible spending', () => {
    const result = buildSpendingActions(
      [
        { category_id: 1, category: 'Y tế', amount: 8000000 },
        { category_id: 2, category: 'Ăn uống', amount: 12000000 },
        { category_id: 3, category: 'Mua sắm', amount: 8000000 },
      ],
      4,
    );
    expect(result[0]).toMatchObject({
      category: 'Mua sắm',
      monthly_baseline: 2000000,
      monthly_target: 1600000,
      monthly_reduction: 400000,
    });
    expect(result[1]).toMatchObject({
      category: 'Ăn uống',
      monthly_reduction: 300000,
    });
    expect(result[2]).toMatchObject({ category: 'Y tế', monthly_reduction: 0 });
  });
  it('does not guess cuts for unknown categories or empty data', () => {
    expect(buildSpendingActions([], 4)).toEqual([]);
    expect(
      buildSpendingActions(
        [{ category_id: 1, category: 'Khoản riêng', amount: 1000 }],
        4,
      )[0].monthly_reduction,
    ).toBe(0);
  });
});
