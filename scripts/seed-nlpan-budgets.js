const fs = require('fs');
const path = require('path');
const { PrismaClient, Prisma } = require('@prisma/client');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const key = match[1].trim();
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}

const prisma = new PrismaClient();
const email = 'nlpan14112004@gmail.com';

const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    0,
  );
const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const startOfWeek = (date) => {
  const start = startOfDay(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
};

const ranges = (now) => {
  const today = startOfDay(now);
  const week = startOfWeek(now);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    day: [-1, 0, 1].map((offset) => {
      const start = addDays(today, offset);
      return {
        start,
        end: endOfDay(start),
        suffix:
          offset === -1 ? 'hôm qua' : offset === 0 ? 'hôm nay' : 'ngày mai',
      };
    }),
    week: [-1, 0, 1].map((offset) => {
      const start = addDays(week, offset * 7);
      return {
        start,
        end: endOfDay(addDays(start, 6)),
        suffix:
          offset === -1 ? 'tuần trước' : offset === 0 ? 'tuần này' : 'tuần sau',
      };
    }),
    month: [-1, 0, 1].map((offset) => {
      const start = new Date(month.getFullYear(), month.getMonth() + offset, 1);
      return {
        start,
        end: endOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0)),
        suffix:
          offset === -1
            ? 'tháng trước'
            : offset === 0
              ? 'tháng này'
              : 'tháng sau',
      };
    }),
  };
};

async function upsertBudget(input) {
  const data = {
    name: input.name,
    wallet_id: input.walletId,
    category_id: input.categoryId,
    scope: input.scope,
    period: input.period,
    start_date: input.start,
    end_date: input.end,
    limit_amount: new Prisma.Decimal(input.limit),
    is_active: true,
    deleted_at: null,
  };
  const existing = await prisma.budgets.findFirst({
    where: {
      user_id: input.userId,
      deleted_at: null,
      scope: input.scope,
      wallet_id: input.walletId,
      category_id: input.categoryId,
      period: input.period,
      start_date: input.start,
      end_date: input.end,
    },
  });

  if (existing) {
    return prisma.budgets.update({ where: { id: existing.id }, data });
  }

  return prisma.budgets.create({
    data: {
      user_id: input.userId,
      wallet_id: input.walletId,
      category_id: input.categoryId,
      scope: input.scope,
      period: input.period,
      start_date: input.start,
      end_date: input.end,
      ...data,
    },
  });
}

async function main() {
  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) throw new Error(`Không tìm thấy user ${email}`);

  const wallets = await prisma.wallets.findMany({
    where: { user_id: user.id, deleted_at: null },
    orderBy: { id: 'asc' },
  });
  if (wallets.length === 0)
    throw new Error('NLPAn chưa có ví để tạo ngân sách');

  const expenseCategory = await prisma.categories.findFirst({
    where: {
      type: 'EXPENSE',
      cash_flow_group: 'NORMAL',
      is_active: true,
      OR: [{ is_system: true }, { user_id: user.id }],
    },
    orderBy: { id: 'asc' },
  });
  const walletFor = (index) => wallets[index % wallets.length];
  const periodRanges = ranges(new Date());
  const inputs = [];

  periodRanges.day.forEach((range, index) =>
    inputs.push({
      userId: user.id,
      walletId: walletFor(0).id,
      categoryId: null,
      scope: 'WALLET',
      period: 'DAY',
      start: range.start,
      end: range.end,
      name: `Ngân sách ngày ${range.suffix}`,
      limit: [50000, 120000, 150000][index],
    }),
  );
  periodRanges.week.forEach((range, index) =>
    inputs.push({
      userId: user.id,
      walletId: walletFor(1).id,
      categoryId: null,
      scope: 'WALLET',
      period: 'WEEK',
      start: range.start,
      end: range.end,
      name: `Ngân sách ${range.suffix}`,
      limit: [400000, 750000, 900000][index],
    }),
  );
  periodRanges.month.forEach((range, index) =>
    inputs.push({
      userId: user.id,
      walletId: walletFor(2).id,
      categoryId: null,
      scope: 'WALLET',
      period: 'MONTH',
      start: range.start,
      end: range.end,
      name: `Ngân sách ${range.suffix}`,
      limit: [3500000, 5000000, 6000000][index],
    }),
  );

  if (expenseCategory) {
    const currentRanges = [
      ['DAY', periodRanges.day[1], 80000],
      ['WEEK', periodRanges.week[1], 350000],
      ['MONTH', periodRanges.month[1], 1800000],
    ];
    currentRanges.forEach(([period, range, limit]) =>
      inputs.push({
        userId: user.id,
        walletId: walletFor(0).id,
        categoryId: expenseCategory.id,
        scope: 'CATEGORY',
        period,
        start: range.start,
        end: range.end,
        name: `${expenseCategory.name} ${range.suffix}`,
        limit,
      }),
    );
  }

  for (const input of inputs) await upsertBudget(input);
  console.log(
    `Đã upsert ${inputs.length} ngân sách ngày/tuần/tháng cho ${email}.`,
  );
}

main().finally(() => prisma.$disconnect());
