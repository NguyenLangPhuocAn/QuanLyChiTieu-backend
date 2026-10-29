// Creates a fresh, isolated visual QA catalog. Never copies or changes real users.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const file = path.resolve(
  __dirname,
  '../.runtime/widget-categories-qa/session.json',
);
const expense = [
  ['Ăn uống', 'food'],
  ['Di chuyển', 'transport'],
  ['Hóa đơn', 'bill'],
  ['Mua sắm', 'shopping'],
  ['Giải trí', 'entertainment'],
  ['Sức khỏe', 'health'],
  ['Nhà ở', 'housing'],
  ['Giáo dục', 'education'],
  ['Du lịch', 'travel'],
  ['Làm đẹp', 'beauty'],
  ['Bảo hiểm', 'insurance'],
  ['Khác', 'other'],
];
const income = [
  ['Lương', 'salary'],
  ['Thưởng', 'bonus'],
  ['Đầu tư', 'investment'],
  ['Quà tặng', 'gift'],
  ['Khác', null],
];
async function main() {
  const base = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../.runtime/recurring-bills-qa/session.json'),
      'utf8',
    ),
  );
  const url = new URL(base.databaseUrl);
  if (
    url.hostname !== '127.0.0.1' ||
    !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)
  )
    throw Error('QA schema only');
  const db = new PrismaClient({
    datasources: { db: { url: base.databaseUrl } },
  });
  try {
    let session;
    if (fs.existsSync(file))
      session = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      if (!process.argv.includes('--prepare'))
        throw Error('Explicit preparation required');
      const password = 'QaOnly_' + randomBytes(12).toString('hex');
      const created = await db.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            email: `qa.widgetcategories.${Date.now()}@example.test`,
            full_name: 'Kiểm thử danh mục',
            password: await bcrypt.hash(password, 10),
            role: 'PREMIUM',
            currency_default: 'VND',
            profile_setup_completed: true,
          },
        });
        const wallet = await tx.wallets.create({
          data: {
            user_id: user.id,
            name: 'Ví tiền mặt',
            currency: 'VND',
            balance: 1000000,
          },
        });
        const choices = [
          ...expense.map(([name, icon]) => ({
            name,
            type: 'EXPENSE',
            icon: icon ? `categories/icons/expense_${icon}.png` : null,
          })),
          ...income.map(([name, icon]) => ({
            name,
            type: 'INCOME',
            icon: icon ? `categories/icons/income_${icon}.png` : null,
          })),
        ];
        await tx.categories.createMany({
          data: choices.map((c) => ({
            ...c,
            user_id: user.id,
            cash_flow_group: 'NORMAL',
            is_system: false,
          })),
        });
        return { userId: user.id, walletId: wallet.id, email: user.email };
      });
      session = { ...base, ...created, password };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(session));
    }
    if (!/^qa\.widgetcategories\.\d+@example\.test$/.test(session.email))
      throw Error('QA identity only');
    const user = await db.users.findUniqueOrThrow({
      where: { id: session.userId },
    });
    const wallet = await db.wallets.findUniqueOrThrow({
      where: { id: session.walletId },
    });
    if (user.email !== session.email || wallet.user_id !== user.id)
      throw Error('Wrong QA owner');
    const categories = await db.categories.findMany({
      where: { user_id: user.id },
      select: { id: true, name: true, type: true, icon: true },
    });
    const count = await db.transactions.count({
      where: { wallet_id: wallet.id },
    });
    console.log(
      JSON.stringify({
        fixture: 'widget-categories',
        userId: user.id,
        walletId: wallet.id,
        categories,
        expense: categories.filter((c) => c.type === 'EXPENSE').length,
        income: categories.filter((c) => c.type === 'INCOME').length,
        count,
        balance: Number(wallet.balance),
        qaOnly: true,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('WIDGET_CATEGORIES_QA_FAILED (private details suppressed)');
  process.exitCode = 1;
});
