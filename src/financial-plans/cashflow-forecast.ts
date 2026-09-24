export type HistoricalCashflowPoint = {
  month: string;
  income: number;
  expense: number;
  transaction_count: number;
};

export type ForecastCashflowPoint = {
  month: string;
  projected_income: number;
  projected_expense: number;
  projected_net: number;
};

const roundMoney = (value: number) =>
  Math.round(Math.max(0, value) * 100) / 100;

const weightedAverage = (values: number[]) => {
  if (!values.length) return 0;
  const denominator = values.reduce((sum, _value, index) => sum + index + 1, 0);
  return (
    values.reduce((sum, value, index) => sum + value * (index + 1), 0) /
    denominator
  );
};

const linearSlope = (values: number[]) => {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const numerator = values.reduce(
    (sum, value, index) => sum + (index - xMean) * (value - yMean),
    0,
  );
  const denominator = values.reduce(
    (sum, _value, index) => sum + (index - xMean) ** 2,
    0,
  );
  return denominator ? numerator / denominator : 0;
};

const cappedSlope = (values: number[]) => {
  const average =
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const cap = average * 0.25;
  return Math.max(-cap, Math.min(cap, linearSlope(values)));
};

const addMonths = (monthKey: string, count: number) => {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const buildCashflowForecast = (
  history: HistoricalCashflowPoint[],
  forecastMonths = 4,
) => {
  const incomes = history.map((point) => point.income);
  const expenses = history.map((point) => point.expense);
  const baseIncome = weightedAverage(incomes);
  const baseExpense = weightedAverage(expenses);
  const incomeSlope = cappedSlope(incomes);
  const expenseSlope = cappedSlope(expenses);
  const latestIncome = incomes.at(-1) ?? baseIncome;
  const latestExpense = expenses.at(-1) ?? baseExpense;
  const lastMonth =
    history.at(-1)?.month ?? new Date().toISOString().slice(0, 7);

  const forecast: ForecastCashflowPoint[] = Array.from(
    { length: forecastMonths },
    (_item, index) => {
      const horizon = index + 1;
      const damping = 0.75 ** index;
      const incomeTrend = Math.max(
        0,
        latestIncome + incomeSlope * horizon * damping,
      );
      const expenseTrend = Math.max(
        0,
        latestExpense + expenseSlope * horizon * damping,
      );
      const projectedIncome = roundMoney(baseIncome * 0.7 + incomeTrend * 0.3);
      const projectedExpense = roundMoney(
        baseExpense * 0.7 + expenseTrend * 0.3,
      );
      return {
        month: addMonths(lastMonth, horizon),
        projected_income: projectedIncome,
        projected_expense: projectedExpense,
        projected_net:
          Math.round((projectedIncome - projectedExpense) * 100) / 100,
      };
    },
  );

  const historyAverageIncome = roundMoney(
    incomes.reduce((sum, value) => sum + value, 0) /
      Math.max(1, incomes.length),
  );
  const historyAverageExpense = roundMoney(
    expenses.reduce((sum, value) => sum + value, 0) /
      Math.max(1, expenses.length),
  );
  const forecastAverageIncome = roundMoney(
    forecast.reduce((sum, point) => sum + point.projected_income, 0) /
      Math.max(1, forecast.length),
  );
  const forecastAverageExpense = roundMoney(
    forecast.reduce((sum, point) => sum + point.projected_expense, 0) /
      Math.max(1, forecast.length),
  );
  const transactionCount = history.reduce(
    (sum, point) => sum + point.transaction_count,
    0,
  );
  const activeMonths = history.filter(
    (point) => point.income > 0 || point.expense > 0,
  ).length;
  const status =
    transactionCount < 6 || activeMonths < 2
      ? 'INSUFFICIENT_DATA'
      : forecastAverageExpense > forecastAverageIncome
        ? 'RISK'
        : historyAverageExpense > 0 &&
            forecastAverageExpense > historyAverageExpense * 1.15
          ? 'WARNING'
          : 'STABLE';

  return {
    history,
    forecast,
    summary: {
      history_average_income: historyAverageIncome,
      history_average_expense: historyAverageExpense,
      forecast_average_income: forecastAverageIncome,
      forecast_average_expense: forecastAverageExpense,
      forecast_average_net:
        Math.round((forecastAverageIncome - forecastAverageExpense) * 100) /
        100,
      transaction_count: transactionCount,
      status,
      confidence:
        transactionCount >= 20 && activeMonths >= 4
          ? 'HIGH'
          : transactionCount >= 10 && activeMonths >= 3
            ? 'MEDIUM'
            : 'LOW',
    },
  } as const;
};
