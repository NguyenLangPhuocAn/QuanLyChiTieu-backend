const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.runtime/bill-suggestions-qa/session.json');
async function main() {
  const existing = fs.existsSync(target);
  const original = JSON.parse(fs.readFileSync(existing ? target : path.join(root, '.runtime/recurring-bills-qa/session.json'), 'utf8'));
  const url = new URL(original.databaseUrl);
  if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)) throw new Error('Unsafe schema');
  if (!existing && !process.argv.includes('--prepare')) throw new Error('Prepare isolated fixture first');
  const db = new PrismaClient({ datasources: { db: { url: original.databaseUrl } } });
  let session = original;
  try {
    if (!existing) {
      const password = `QaOnly_${randomBytes(12).toString('hex')}`;
      const prepared = await db.$transaction(async tx => {
        const user = await tx.users.create({ data: { email: `qa.suggestions.${Date.now()}@example.test`, full_name: 'Gợi ý QA', password: await bcrypt.hash(password, 10), role: 'BASIC', currency_default: 'VND', profile_setup_completed: true } });
        const wallet = await tx.wallets.create({ data: { user_id: user.id, name: 'Ví gợi ý QA', currency: 'VND', balance: 8848000 } });
        const category = await tx.categories.create({ data: { user_id: user.id, name: 'Hóa đơn gợi ý QA', type: 'EXPENSE', cash_flow_group: 'NORMAL', is_system: false } });
        const rows = [];
        for (const [name, dates, amounts] of [
          ['Internet QA', ['2026-07-31', '2026-08-31', '2026-09-30'], [240000, 260000, 250000]],
          ['Video QA', ['2026-07-05', '2026-08-05', '2026-09-05'], [89000, 89000, 89000]],
          ['Music QA', ['2026-07-14', '2026-08-14', '2026-09-14'], [45000, 45000, 45000]],
        ]) for (let i = 0; i < dates.length; i++) {
          const row = await tx.transactions.create({ data: { wallet_id: wallet.id, category_id: category.id, currency: 'VND', amount: -amounts[i], note: name, transaction_date: new Date(`${dates[i]}T05:00:00Z`) } });
          rows.push({ id: row.id, note: row.note, amount: Number(row.amount), date: row.transaction_date.toISOString() });
        }
        return { userId: user.id, walletId: wallet.id, email: user.email, rows };
      });
      session = { databaseUrl: original.databaseUrl, database: original.database, ...prepared, password, jwtSecret: original.jwtSecret };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(session));
    }
    const wallet = await db.wallets.findUniqueOrThrow({ where: { id: session.walletId } });
    const rows = await db.transactions.findMany({ where: { wallet_id: wallet.id }, orderBy: { id: 'asc' } });
    const unchanged = Number(wallet.balance) === 8848000 && wallet.user_id === session.userId && rows.length === 9
      && rows.every((row, i) => row.id === session.rows[i].id && Number(row.amount) === session.rows[i].amount && row.note === session.rows[i].note && row.transaction_date.toISOString() === session.rows[i].date);
    console.log(JSON.stringify({ fixture: 'bill-suggestions-2026-10-27', isolatedLocalSchema: session.database, userId: session.userId, walletId: wallet.id, transactionCount: rows.length, walletBalance: Number(wallet.balance), rows: session.rows, fixtureUnchanged: unchanged }));
    if (!unchanged) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(JSON.stringify({ error: error.code || 'QA_FIXTURE_FAILED' })); process.exitCode = 1; });
