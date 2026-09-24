export type AnalysisRow = {
  category: string;
  type: string;
  amount: number;
  date: Date;
};

export function analyzeReportRows(rows: AnalysisRow[]) {
  const categories = new Map<
    string,
    { category: string; amount: number; count: number }
  >();
  const months = new Map<
    string,
    {
      month: string;
      income: number;
      expense: number;
      net: number;
      count: number;
    }
  >();
  for (const row of rows) {
    const month = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
    const entry = months.get(month) ?? {
      month,
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
    };
    entry.count += 1;
    if (row.type === 'Chi') {
      entry.expense += row.amount;
      const category = categories.get(row.category) ?? {
        category: row.category,
        amount: 0,
        count: 0,
      };
      category.amount += row.amount;
      category.count += 1;
      categories.set(row.category, category);
    } else {
      entry.income += row.amount;
    }
    entry.net = entry.income - entry.expense;
    months.set(month, entry);
  }
  const expense = [...categories.values()].reduce(
    (sum, row) => sum + row.amount,
    0,
  );
  return {
    categories: [...categories.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((row) => ({
        ...row,
        percent: expense ? (row.amount / expense) * 100 : 0,
      })),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
