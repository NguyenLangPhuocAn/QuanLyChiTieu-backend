// Fixed isolated QA8 fixture; never connects to production or changes existing money.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/widget-categories-qa/session.json'), 'utf8'));
const url = new URL(session.databaseUrl);
if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname) || session.userId !== 8 || session.walletId !== 8 || !/^qa\.widgetcategories\.\d+@example\.test$/.test(session.email)) throw Error('Isolated QA8 only');
const db = new PrismaClient({ datasources: { db: { url: session.databaseUrl } } });
const folder = path.join(__dirname, '../../mobile/qa/evidence/2026-10-30-widget-inline-form');
const choices = [
  { name: 'Ngân hàng QA', wallet_type: 'BANK' },
  { name: 'Ví điện tử QA', wallet_type: 'E_WALLET' },
  { name: 'Ví chi tiêu cá nhân và gia đình QA', wallet_type: 'CASH' },
];
const snapshot = async () => JSON.parse(JSON.stringify({
  wallet: await db.wallets.findUniqueOrThrow({ where: { id: 8 }, select: { id: true, user_id: true, balance: true } }),
  transactions: await db.transactions.findMany({ where: { wallet_id: { in: (await db.wallets.findMany({ where: { user_id: 8 }, select: { id: true } })).map(w => w.id) } }, select: { id: true, wallet_id: true, amount: true }, orderBy: { id: 'asc' } }),
  loans: await db.loan_debts.findMany({ where: { user_id: 8 }, select: { id: true, principal_amount: true }, orderBy: { id: 'asc' } }),
}));
async function main() {
  try {
    const stage = process.argv[2];
    assert.ok(['prepare', 'final'].includes(stage));
    const user = await db.users.findUniqueOrThrow({ where: { id: 8 } });
    assert.equal(user.email, session.email);
    const money = await snapshot();
    assert.equal(money.wallet.user_id, 8);
    fs.mkdirSync(folder, { recursive: true });
    if (stage === 'prepare') {
      fs.writeFileSync(path.join(folder, 'sql-before.json'), JSON.stringify(money, null, 2) + '\n', { flag: 'wx' });
      await db.$transaction(async tx => {
        for (const choice of choices) {
          assert.equal(await tx.wallets.count({ where: { user_id: 8, name: choice.name } }), 0);
          await tx.wallets.create({ data: { ...choice, user_id: 8, currency: 'VND', balance: 0 } });
        }
      });
      assert.deepEqual(await snapshot(), money);
    } else {
      assert.deepEqual(money, JSON.parse(fs.readFileSync(path.join(folder, 'sql-before.json'), 'utf8')));
      const wallets = await db.wallets.findMany({ where: { user_id: 8 }, select: { id: true, name: true, currency: true, balance: true }, orderBy: { id: 'asc' } });
      for (const choice of choices) assert.equal(Number(wallets.find(w => w.name === choice.name)?.balance), 0);
      fs.writeFileSync(path.join(folder, 'sql-final.json'), JSON.stringify({ ...money, wallets }, null, 2) + '\n', { flag: 'wx' });
    }
    console.log(JSON.stringify({ stage, qaUserId: 8, moneyUnchanged: true, transactionIds: money.transactions.map(t => t.id) }));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('INLINE_FORM_QA_FAILED (private details suppressed)'); process.exitCode = 1; });
