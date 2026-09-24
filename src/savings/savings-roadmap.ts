type GoalInput = {
  target_amount: number;
  current_amount: number;
  target_date?: Date | string | null;
  status?: string;
  entries: Array<{ type: string; amount: number; entry_date: Date | string }>;
};

const day = (value: Date | string) => {
  // A goal deadline is a calendar date, independent of UTC offset.
  const key =
    typeof value === 'string'
      ? value.slice(0, 10)
      : value.toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
};
const key = (value: Date) => value.toISOString().slice(0, 10);
const cents = (value: number) => Math.round(value * 100);

export function buildSavingsRoadmap(goal: GoalInput, now = new Date()) {
  const today = day(now);
  const deadline = goal.target_date ? day(goal.target_date) : null;
  const validDeadline =
    deadline && Number.isFinite(deadline.getTime()) ? deadline : null;
  const remaining =
    goal.status === 'COMPLETED'
      ? 0
      : Math.max(0, goal.target_amount - goal.current_amount);
  const overdue = Boolean(
    validDeadline && validDeadline < today && remaining > 0,
  );
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const historyStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1),
  );
  let recentNet = 0;
  let contributedThisMonth = 0;
  for (const entry of goal.entries) {
    const when = day(entry.entry_date);
    const amount = entry.type === 'WITHDRAWAL' ? -entry.amount : entry.amount;
    if (when >= historyStart && when < monthStart) recentNet += amount;
    if (when >= monthStart && when <= today) contributedThisMonth += amount;
  }
  const recentMonthly = Math.round(Math.max(0, recentNet / 3) * 100) / 100;
  const months =
    validDeadline && !overdue && remaining > 0
      ? (validDeadline.getUTCFullYear() - today.getUTCFullYear()) * 12 +
        validDeadline.getUTCMonth() -
        today.getUTCMonth() +
        1
      : 0;
  // Reconstruct the opening-month balance so paying the suggested installment
  // does not create another installment for the same month after a refresh.
  const installmentCents = months
    ? Math.ceil(Math.max(0, cents(remaining + contributedThisMonth)) / months)
    : 0;
  const firstCents =
    months === 1
      ? cents(remaining)
      : Math.min(
          cents(remaining),
          Math.max(0, installmentCents - cents(contributedThisMonth)),
        );
  const futureCents =
    months > 1 ? Math.ceil((cents(remaining) - firstCents) / (months - 1)) : 0;
  const weekly =
    validDeadline && !overdue && remaining > 0
      ? Math.ceil(
          cents(remaining) /
            Math.max(
              1,
              Math.ceil(
                ((validDeadline.getTime() - today.getTime()) / 86400000 + 1) /
                  7,
              ),
            ),
        ) / 100
      : null;
  const schedule = Array.from({ length: Math.min(months, 12) }, (_, index) => {
    const monthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + index + 1, 0),
    );
    const dueDate =
      validDeadline && monthEnd > validDeadline ? validDeadline : monthEnd;
    const paidBefore =
      index === 0
        ? 0
        : Math.min(cents(remaining), firstCents + futureCents * (index - 1));
    const amount =
      Math.min(
        index === 0 ? firstCents : futureCents,
        cents(remaining) - paidBefore,
      ) / 100;
    return {
      due_date: key(dueDate),
      amount,
      target_balance: Math.min(
        goal.target_amount,
        Math.round((goal.current_amount + paidBefore / 100 + amount) * 100) /
          100,
      ),
    };
  });
  const monthsAtCurrentPace =
    recentMonthly > 0 && remaining > 0
      ? Math.ceil(remaining / recentMonthly)
      : null;
  return {
    status:
      remaining === 0
        ? 'COMPLETE'
        : !validDeadline
          ? 'NO_DEADLINE'
          : overdue
            ? 'OVERDUE'
            : 'SCHEDULED',
    remaining_amount: remaining,
    remaining_months: months,
    contributed_this_month: Math.round(contributedThisMonth * 100) / 100,
    next_contribution: schedule[0]?.amount ?? null,
    next_due_date: schedule[0]?.due_date ?? null,
    weekly_amount: weekly,
    recent_monthly_contribution: recentMonthly,
    recent_history_months: 3,
    months_at_current_pace: monthsAtCurrentPace,
    monthly_pace_gap: months
      ? Math.max(
          0,
          Math.round((installmentCents / 100 - recentMonthly) * 100) / 100,
        )
      : null,
    schedule,
    schedule_truncated: months > 12,
  };
}
