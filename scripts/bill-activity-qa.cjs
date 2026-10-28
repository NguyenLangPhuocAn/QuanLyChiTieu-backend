const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const file = path.resolve(__dirname, '../.runtime/bill-activity-qa/session.json');
let phase = 'INIT';
async function main() {
  const exists = fs.existsSync(file);
  let session = JSON.parse(fs.readFileSync(exists ? file : path.resolve(__dirname, '../.runtime/recurring-bills-qa/session.json'), 'utf8'));
  const url = new URL(session.databaseUrl);
  if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)) throw new Error('QA schema required');
  if (!exists && !process.argv.includes('--prepare')) throw new Error('Prepare isolated fixture first');
  const db = new PrismaClient({ datasources: { db: { url: session.databaseUrl } } });
  try {
    if (!exists) {
      const password = `QaOnly_${randomBytes(12).toString('hex')}`;
      const fixture = await db.$transaction(async tx => {
        const user = await tx.users.create({ data: { email: `qa.activity.${Date.now()}@example.test`, full_name: 'Khoản định kỳ QA', password: await bcrypt.hash(password, 10), role: 'BASIC', currency_default: 'VND', profile_setup_completed: true } });
        const wallet = await tx.wallets.create({ data: { user_id: user.id, name: 'Ví cảnh báo QA', currency: 'VND', balance: 1125000 } });
        const category = await tx.categories.create({ data: { user_id: user.id, name: 'Hóa đơn kiểm tra QA', type: 'EXPENSE', cash_flow_group: 'NORMAL', is_system: false } });
        const rows = [];
        for (const [name, dates, amounts] of [
          ['Internet QA', ['2026-07-28', '2026-08-28', '2026-09-28', '2026-10-28'], [100000, 100000, 100000, 130000]],
          ['Video QA', ['2026-07-28', '2026-08-28', '2026-09-28', '2026-10-28', '2026-10-28'], [89000, 89000, 89000, 89000, 89000]],
        ]) for (let i = 0; i < dates.length; i++) {
          const row = await tx.transactions.create({ data: { wallet_id: wallet.id, category_id: category.id, amount: -amounts[i], currency: 'VND', note: name, transaction_date: new Date(`${dates[i]}T00:00:00Z`) } });
          rows.push({ id: row.id, amount: Number(row.amount), note: row.note, date: row.transaction_date.toISOString() });
        }
        return { userId: user.id, walletId: wallet.id, email: user.email, rows };
      });
      session = { databaseUrl: session.databaseUrl, database: session.database, jwtSecret: session.jwtSecret, ...fixture, password };
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(session));
    }
    if (!/^qa\.activity\.\d+@example\.test$/.test(session.email)) throw new Error('QA identity required');
    const wallet = await db.wallets.findUniqueOrThrow({ where: { id: session.walletId } });
    const rows = await db.transactions.findMany({ where: { wallet_id: wallet.id }, orderBy: { id: 'asc' } });
    const unchanged = wallet.user_id === session.userId && Number(wallet.balance) === 1125000 && rows.length === 9
      && rows.every((row, i) => row.id === session.rows[i].id && Number(row.amount) === session.rows[i].amount && row.note === session.rows[i].note && row.transaction_date.toISOString() === session.rows[i].date);
    if (!unchanged) throw new Error('Fixture changed');
    let http;
    if (process.argv.includes('--http')) {
      phase = 'HTTP_LOGIN';
      const login = await fetch('http://127.0.0.1:3000/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: session.email, password: session.password }) });
      const auth = await login.json();
      phase = `HTTP_LOGIN_${login.status}`;
      if (login.status !== 201) throw new Error('QA login failed');
      const headers = { Authorization: `Bearer ${auth.accessToken || auth.token}` };
      phase = 'HTTP_PROFILE';
      const profile = await fetch('http://127.0.0.1:3000/users/me', { headers });
      if (!profile.ok || (await profile.json()).id !== session.userId) throw new Error('QA profile failed');
      phase = 'HTTP_HISTORY';
      const history = await fetch('http://127.0.0.1:3000/transactions?type=EXPENSE&cash_flow=normal&page=1&limit=100&from=2023-10-28&to=2026-10-28', { headers });
      const data = await history.json();
      if (!history.ok || data.meta?.total !== 9 || data.data?.length !== 9) throw new Error('QA history mismatch');
      http = { login: login.status, history: history.status, rows: data.data.length, total: data.meta.total, complete: data.meta.totalPages === 1 };
    }
    console.log(JSON.stringify({ fixture: 'bill-activity-2026-10-28', userId: session.userId, walletId: session.walletId, transactionCount: rows.length, walletBalance: Number(wallet.balance), rows: session.rows, fixtureUnchanged: unchanged, ...(http ? { http } : {}) }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(JSON.stringify({ error: error.code || 'QA_ACTIVITY_FAILED', phase })); process.exitCode = 1; });
