const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const file = path.resolve(
  __dirname,
  '../.runtime/widget-input-qa/session.json',
);
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
            email: `qa.widgetinput.${Date.now()}@example.test`,
            full_name: 'Widget nhập nhanh QA',
            password: await bcrypt.hash(password, 10),
            role: 'PREMIUM',
            currency_default: 'VND',
            profile_setup_completed: true,
          },
        });
        const wallet = await tx.wallets.create({
          data: {
            user_id: user.id,
            name: 'Ví nhập nhanh QA',
            currency: 'VND',
            balance: 1000000,
          },
        });
        await tx.categories.createMany({
          data: [
            {
              user_id: user.id,
              name: 'Ăn uống QA',
              type: 'EXPENSE',
              cash_flow_group: 'NORMAL',
              is_system: false,
            },
            {
              user_id: user.id,
              name: 'Đi lại QA',
              type: 'EXPENSE',
              cash_flow_group: 'NORMAL',
              is_system: false,
            },
            {
              user_id: user.id,
              name: 'Lương QA',
              type: 'INCOME',
              cash_flow_group: 'NORMAL',
              is_system: false,
            },
          ],
        });
        return { userId: user.id, walletId: wallet.id, email: user.email };
      });
      session = { ...base, ...created, password };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(session));
    }
    if (!/^qa\.widgetinput\.\d+@example\.test$/.test(session.email))
      throw Error('QA identity only');
    const user = await db.users.findUniqueOrThrow({
      where: { id: session.userId },
    });
    const wallet = await db.wallets.findUniqueOrThrow({
      where: { id: session.walletId },
    });
    if (user.email !== session.email || wallet.user_id !== session.userId)
      throw Error('Wrong QA owner');
    const categories = await db.categories.findMany({
      where: { user_id: user.id },
      select: { id: true, name: true, type: true },
    });
    const transactions = await db.transactions.findMany({
      where: { wallet_id: wallet.id },
      select: {
        id: true,
        amount: true,
        category_id: true,
        receipt_image: true,
      },
    });
    console.log(
      JSON.stringify({
        fixture: 'widget-input',
        userId: user.id,
        walletId: wallet.id,
        balance: Number(wallet.balance),
        categories,
        transactions,
        count: transactions.length,
        qaOnly: true,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('WIDGET_INPUT_QA_FAILED (private details suppressed)');
  process.exitCode = 1;
});
