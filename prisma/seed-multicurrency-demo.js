const fs = require('fs');
const path = require('path');
const { PrismaClient, Prisma } = require('@prisma/client');
const bcrypt = require('bcrypt');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
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
}

const prisma = new PrismaClient();
const email = 'khanh.usd@gmail.com';
const legacyEmail = 'khanh.usd.demo@gmail.com';
const password = 'User@12345';
const rateUsdToVnd = new Prisma.Decimal('25400');
const rateVndToUsd = new Prisma.Decimal('0.00003937');
const source = 'Seeded demo rate';

function localDate(year, month, day, hour = 9, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0);
}

async function ensureCategory(name, type, icon) {
  const normalizedName = name.toLowerCase();
  const existed = await prisma.categories.findFirst({
    where: { name: normalizedName, type, is_system: true },
  });

  if (existed) {
    return existed;
  }

  return prisma.categories.create({
    data: {
      name: normalizedName,
      type,
      icon,
      is_system: true,
      user_id: null,
    },
  });
}

async function ensureWallet(userId, name, walletType, currency) {
  const existed = await prisma.wallets.findFirst({
    where: { user_id: userId, name },
  });

  if (existed) {
    return prisma.wallets.update({
      where: { id: existed.id },
      data: {
        wallet_type: walletType,
        currency,
        is_active: true,
        deleted_at: null,
      },
    });
  }

  return prisma.wallets.create({
    data: {
      user_id: userId,
      name,
      wallet_type: walletType,
      currency,
      balance: 0,
      is_active: true,
    },
  });
}

async function ensureTag(userId, name) {
  const normalizedName = name.toLowerCase();
  const existed = await prisma.tags.findFirst({
    where: { user_id: userId, name: normalizedName },
  });

  return existed ?? prisma.tags.create({ data: { user_id: userId, name: normalizedName } });
}

async function attachTags(transactionId, tags) {
  await prisma.transaction_tags.deleteMany({ where: { transaction_id: transactionId } });

  for (const tag of tags) {
    await prisma.transaction_tags.create({
      data: {
        transaction_id: transactionId,
        tag_id: tag.id,
      },
    });
  }
}

async function ensureTransaction(userId, data, tags) {
  const existed = await prisma.transactions.findFirst({
    where: {
      wallet_id: data.wallet_id,
      note: data.note,
      transaction_date: data.transaction_date,
    },
  });
  const transactionData = {
    wallet_id: data.wallet_id,
    category_id: data.category_id,
    amount: data.amount,
    currency: data.currency,
    converted_amount: data.converted_amount,
    converted_currency: data.converted_currency,
    exchange_rate_used: data.exchange_rate_used,
    note: data.note,
    transaction_date: data.transaction_date,
  };
  const transaction = existed
    ? await prisma.transactions.update({
        where: { id: existed.id },
        data: transactionData,
      })
    : await prisma.transactions.create({ data: transactionData });

  await attachTags(transaction.id, tags);

  return transaction;
}

async function ensureRate(baseCurrency, targetCurrency, rate) {
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + 365 * 24 * 60 * 60 * 1000);

  await prisma.exchange_rates.upsert({
    where: {
      base_currency_target_currency_source: {
        base_currency: baseCurrency,
        target_currency: targetCurrency,
        source,
      },
    },
    update: {
      rate,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
    },
    create: {
      base_currency: baseCurrency,
      target_currency: targetCurrency,
      source,
      rate,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
    },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(password, 10);
  const legacyUser = await prisma.users.findUnique({ where: { email: legacyEmail } });
  if (legacyUser) {
    await prisma.users.update({
      where: { id: legacyUser.id },
      data: { email },
    });
  }

  const user = await prisma.users.upsert({
    where: { email },
    update: {
      full_name: 'Nguyen Minh Khanh USD',
      role: 'PREMIUM',
      currency_default: 'USD',
      is_active: true,
      must_change_password: false,
      profile_setup_completed: true,
    },
    create: {
      email,
      password: passwordHash,
      full_name: 'Nguyen Minh Khanh USD',
      phone: '0919001122',
      birthday: new Date('1996-06-15T00:00:00.000Z'),
      address: 'Quan 1, TP. Ho Chi Minh',
      role: 'PREMIUM',
      currency_default: 'USD',
      provider: 'local',
      is_active: true,
      must_change_password: false,
      profile_setup_completed: true,
    },
  });

  const [salaryCategory, foodCategory, travelCategory, shoppingCategory] = await Promise.all([
    ensureCategory('luong usd', 'INCOME', 'income_salary.png'),
    ensureCategory('an uong', 'EXPENSE', 'expense_food.png'),
    ensureCategory('du lich', 'EXPENSE', 'expense_travel.png'),
    ensureCategory('mua sam', 'EXPENSE', 'expense_shopping.png'),
  ]);
  const [usdWallet, vndWallet] = await Promise.all([
    ensureWallet(user.id, 'USD Checking', 'BANK', 'USD'),
    ensureWallet(user.id, 'Tien mat VND', 'CASH', 'VND'),
  ]);
  const [workTag, foodTag, travelTag, shoppingTag] = await Promise.all([
    ensureTag(user.id, 'usd-income'),
    ensureTag(user.id, 'an-uong'),
    ensureTag(user.id, 'du-lich'),
    ensureTag(user.id, 'mua-sam'),
  ]);

  await Promise.all([
    ensureRate('USD', 'VND', rateUsdToVnd),
    ensureRate('VND', 'USD', rateVndToUsd),
    ensureRate('USD', 'USD', new Prisma.Decimal(1)),
    ensureRate('VND', 'VND', new Prisma.Decimal(1)),
  ]);

  const transactions = [
    await ensureTransaction(
      user.id,
      {
        wallet_id: usdWallet.id,
        category_id: salaryCategory.id,
        amount: new Prisma.Decimal('1800'),
        currency: 'USD',
        converted_amount: new Prisma.Decimal('1800'),
        converted_currency: 'USD',
        exchange_rate_used: new Prisma.Decimal(1),
        note: 'Luong remote thang 5',
        transaction_date: localDate(2026, 5, 3, 9, 0),
      },
      [workTag],
    ),
    await ensureTransaction(
      user.id,
      {
        wallet_id: usdWallet.id,
        category_id: foodCategory.id,
        amount: new Prisma.Decimal('-42.50'),
        currency: 'USD',
        converted_amount: new Prisma.Decimal('42.50'),
        converted_currency: 'USD',
        exchange_rate_used: new Prisma.Decimal(1),
        note: 'An toi voi doi tac',
        transaction_date: localDate(2026, 5, 6, 19, 30),
      },
      [foodTag],
    ),
    await ensureTransaction(
      user.id,
      {
        wallet_id: usdWallet.id,
        category_id: travelCategory.id,
        amount: new Prisma.Decimal('-180'),
        currency: 'USD',
        converted_amount: new Prisma.Decimal('180'),
        converted_currency: 'USD',
        exchange_rate_used: new Prisma.Decimal(1),
        note: 'Dat phong khach san',
        transaction_date: localDate(2026, 5, 12, 14, 15),
      },
      [travelTag],
    ),
    await ensureTransaction(
      user.id,
      {
        wallet_id: vndWallet.id,
        category_id: shoppingCategory.id,
        amount: new Prisma.Decimal('-760000'),
        currency: 'VND',
        converted_amount: new Prisma.Decimal('29.90'),
        converted_currency: 'USD',
        exchange_rate_used: rateVndToUsd,
        note: 'Mua do dung trong nuoc',
        transaction_date: localDate(2026, 5, 16, 16, 45),
      },
      [shoppingTag],
    ),
  ];

  const walletIds = [usdWallet.id, vndWallet.id];
  const totals = await prisma.transactions.groupBy({
    by: ['wallet_id'],
    where: { wallet_id: { in: walletIds } },
    _sum: { amount: true },
  });

  for (const wallet of [usdWallet, vndWallet]) {
    const total = totals.find((item) => item.wallet_id === wallet.id)?._sum.amount ?? new Prisma.Decimal(0);
    await prisma.wallets.update({
      where: { id: wallet.id },
      data: { balance: total },
    });
  }

  const currentMonthStart = new Date(2026, 4, 1);
  const currentMonthEnd = new Date(2026, 4, 31, 23, 59, 59);
  const existingBudget = await prisma.budgets.findFirst({
    where: {
      user_id: user.id,
      wallet_id: usdWallet.id,
      scope: 'WALLET',
      category_id: null,
      period: 'MONTH',
      start_date: currentMonthStart,
      end_date: currentMonthEnd,
    },
  });
  if (existingBudget) {
    await prisma.budgets.update({
      where: { id: existingBudget.id },
      data: { limit_amount: new Prisma.Decimal('900') },
    });
  } else {
    await prisma.budgets.create({
      data: {
        user_id: user.id,
        name: 'USD monthly budget',
        wallet_id: usdWallet.id,
        category_id: null,
        scope: 'WALLET',
        limit_amount: new Prisma.Decimal('900'),
        period: 'MONTH',
        start_date: currentMonthStart,
        end_date: currentMonthEnd,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        email,
        password,
        userId: user.id,
        wallets: [
          { id: usdWallet.id, name: usdWallet.name, currency: 'USD' },
          { id: vndWallet.id, name: vndWallet.name, currency: 'VND' },
        ],
        transactions: transactions.map((item) => item.id),
      },
      null,
      2,
    ),
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
