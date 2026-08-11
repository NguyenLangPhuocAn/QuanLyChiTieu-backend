const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PrismaClient, Prisma } = require('@prisma/client');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (!match) {
    continue;
  }
  const key = match[1].trim();
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}

const prisma = new PrismaClient();
const email = 'nlpan14112004@gmail.com';
const start = new Date(2026, 0, 1);
const today = new Date(2026, 4, 19, 23, 59, 59);
const tagCache = new Map();
const categoryCache = new Map();

function d(year, month, day) {
  return new Date(year, month - 1, day, 9, 0, 0);
}

function clamp(date) {
  return date <= today ? date : null;
}

async function getCategory(name, type, icon) {
  const key = `${type}:${name}`;
  if (categoryCache.has(key)) {
    return categoryCache.get(key);
  }

  let category = await prisma.categories.findFirst({ where: { name, type } });
  if (!category) {
    category = await prisma.categories.create({
      data: { name, type, icon, is_system: true, user_id: null },
    });
  }

  categoryCache.set(key, category);
  return category;
}

async function getTag(userId, name) {
  const normalized = name.toLowerCase();
  const key = `${userId}:${normalized}`;
  if (tagCache.has(key)) {
    return tagCache.get(key);
  }

  let tag = await prisma.tags.findFirst({ where: { user_id: userId, name: normalized } });
  if (!tag) {
    tag = await prisma.tags.create({ data: { user_id: userId, name: normalized } });
  }

  tagCache.set(key, tag);
  return tag;
}

async function ensureWallet(userId, name, walletType) {
  let wallet =
    (await prisma.wallets.findFirst({ where: { user_id: userId, name } })) ??
    (await prisma.wallets.findFirst({ where: { user_id: userId, wallet_type: walletType } }));

  if (wallet) {
    return prisma.wallets.update({
      where: { id: wallet.id },
      data: { name, wallet_type: walletType, currency: 'VND' },
    });
  }

  return prisma.wallets.create({
    data: {
      user_id: userId,
      name,
      wallet_type: walletType,
      currency: 'VND',
      balance: 0,
    },
  });
}

async function ensureMonthlyBudget(userId, walletId, amount) {
  if (!amount) {
    return null;
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const existed = await prisma.budgets.findFirst({
    where: {
      user_id: userId,
      wallet_id: walletId,
      scope: 'WALLET',
      category_id: null,
      start_date: startDate,
      end_date: endDate,
    },
  });

  if (existed) {
    return prisma.budgets.update({
      where: { id: existed.id },
      data: { limit_amount: amount, period: 'MONTH' },
    });
  }

  return prisma.budgets.create({
    data: {
      user_id: userId,
      name: 'Ngân sách tháng',
      wallet_id: walletId,
      category_id: null,
      scope: 'WALLET',
      limit_amount: amount,
      period: 'MONTH',
      start_date: startDate,
      end_date: endDate,
    },
  });
}

async function main() {
  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`Không tìm thấy user ${email}`);
  }

  const existingWallets = await prisma.wallets.findMany({ where: { user_id: user.id }, select: { id: true } });
  const existingWalletIds = existingWallets.map((wallet) => wallet.id);
  const oldTransactions = existingWalletIds.length
    ? await prisma.transactions.findMany({
        where: {
          wallet_id: { in: existingWalletIds },
          transaction_date: { gte: start, lte: today },
        },
        select: { id: true },
      })
    : [];
  const oldIds = oldTransactions.map((transaction) => transaction.id);

  if (oldIds.length) {
    await prisma.transaction_tags.deleteMany({ where: { transaction_id: { in: oldIds } } });
    await prisma.transactions.deleteMany({ where: { id: { in: oldIds } } });
  }

  const cash = await ensureWallet(user.id, 'Tiền mặt cá nhân', 'CASH');
  const bank = await ensureWallet(user.id, 'Tài khoản ngân hàng', 'BANK');
  const ewallet = await ensureWallet(user.id, 'Ví điện tử', 'E_WALLET');
  await ensureMonthlyBudget(user.id, ewallet.id, 3000000);
  const wallets = [cash, bank, ewallet];

  const cats = {
    salary: await getCategory('Tiền lương', 'INCOME', 'categories/icons/income_salary.png'),
    bonus: await getCategory('Tiền thưởng', 'INCOME', 'categories/icons/income_bonus.png'),
    gift: await getCategory('Quà tặng', 'INCOME', 'categories/icons/income_gift.png'),
    food: await getCategory('Ăn uống', 'EXPENSE', 'categories/icons/expense_food.png'),
    transport: await getCategory('Di chuyển', 'EXPENSE', 'categories/icons/expense_transport.png'),
    bill: await getCategory('Hóa đơn', 'EXPENSE', 'categories/icons/expense_bill.png'),
    housing: await getCategory('Nhà ở', 'EXPENSE', 'categories/icons/expense_housing.png'),
    shopping: await getCategory('Mua sắm', 'EXPENSE', 'categories/icons/expense_shopping.png'),
    health: await getCategory('Sức khỏe', 'EXPENSE', 'categories/icons/expense_health.png'),
    education: await getCategory('Giáo dục', 'EXPENSE', 'categories/icons/expense_education.png'),
    entertainment: await getCategory('Giải trí', 'EXPENSE', 'categories/icons/expense_entertainment.png'),
    saving: await getCategory('Tiết kiệm', 'EXPENSE', 'categories/icons/expense_saving.png'),
  };

  const rows = [];
  const add = (date, wallet, category, amount, note, tags = []) => {
    const transactionDate = clamp(date);
    if (!transactionDate) {
      return;
    }
    rows.push({ transactionDate, wallet, category, amount, note, tags });
  };

  for (let month = 1; month <= 5; month += 1) {
    add(d(2026, month, 5), bank, cats.salary, 18000000 + month * 250000, `Lương tháng ${month}/2026`, ['luong', 'congviec']);
    add(d(2026, month, 6), bank, cats.saving, -3000000, `Chuyển tiết kiệm tháng ${month}`, ['tietkiem']);
    add(d(2026, month, 2), bank, cats.housing, -4500000, `Tiền thuê nhà tháng ${month}`, ['nhatro']);
    add(d(2026, month, 10), ewallet, cats.bill, -850000 - month * 20000, `Điện nước internet tháng ${month}`, ['hoadon']);
    add(d(2026, month, 12), ewallet, cats.entertainment, -199000, 'Gói xem phim và nhạc', ['giaitri']);
    add(d(2026, month, 14), cash, cats.transport, -650000 - month * 15000, `Xăng xe tháng ${month}`, ['dichuyen']);
    add(d(2026, month, 18), ewallet, cats.bill, -320000, 'Nạp điện thoại', ['hoadon']);

    if (month === 1) add(d(2026, 1, 22), bank, cats.bonus, 2500000, 'Thưởng khởi động dự án', ['thuong', 'congviec']);
    if (month === 2) add(d(2026, 2, 8), cash, cats.gift, 1200000, 'Lì xì Tết', ['giadinh']);
    if (month === 3) add(d(2026, 3, 20), bank, cats.bonus, 3500000, 'Thưởng hoàn thành milestone', ['thuong', 'congviec']);
    if (month === 4) add(d(2026, 4, 16), bank, cats.health, -1250000, 'Khám sức khỏe tháng 4', ['suckhoe']);
    if (month === 5) add(d(2026, 5, 9), bank, cats.education, -1800000, 'Khóa học phân tích dữ liệu', ['hoctap']);

    for (const day of [3, 7, 11, 15, 19, 23, 27]) {
      add(d(2026, month, day), ewallet, cats.food, -(145000 + ((month * day) % 6) * 18000), `Ăn uống ngày ${day}/${month}`, ['anuong']);
    }

    for (const day of [4, 13, 21]) {
      add(d(2026, month, day), cash, cats.food, -(55000 + ((month + day) % 4) * 12000), `Cà phê/gặp bạn ${day}/${month}`, ['cafe']);
    }

    for (const day of [9, 24]) {
      add(d(2026, month, day), ewallet, cats.transport, -(75000 + ((month * day) % 5) * 10000), `Taxi/xe công nghệ ${day}/${month}`, ['dichuyen']);
    }

    if (month <= 4) add(d(2026, month, 26), ewallet, cats.shopping, -(680000 + month * 90000), `Mua đồ dùng cá nhân tháng ${month}`, ['muasam']);
    if (month === 5) add(d(2026, 5, 17), ewallet, cats.shopping, -920000, 'Mua vật dụng làm việc', ['muasam', 'congviec']);
  }

  let created = 0;
  for (const row of rows.sort((left, right) => left.transactionDate.getTime() - right.transactionDate.getTime())) {
    const transaction = await prisma.transactions.create({
      data: {
        wallet_id: row.wallet.id,
        category_id: row.category.id,
        amount: new Prisma.Decimal(row.amount),
        note: row.note,
        transaction_date: row.transactionDate,
      },
    });

    for (const tagName of row.tags) {
      const tag = await getTag(user.id, tagName);
      await prisma.transaction_tags.create({ data: { transaction_id: transaction.id, tag_id: tag.id } });
    }
    created += 1;
  }

  for (const wallet of wallets) {
    const aggregate = await prisma.transactions.aggregate({
      where: { wallet_id: wallet.id },
      _sum: { amount: true },
    });
    await prisma.wallets.update({
      where: { id: wallet.id },
      data: { balance: aggregate._sum.amount ?? 0 },
    });
  }

  console.log(JSON.stringify({ email, deleted: oldIds.length, created, wallets: wallets.map((wallet) => wallet.name) }, null, 2));

  execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'seed-nlpan-budgets.js')],
    { stdio: 'inherit' },
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
