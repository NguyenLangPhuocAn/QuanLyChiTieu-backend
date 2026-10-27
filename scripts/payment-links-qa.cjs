const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const file = path.join(root, '.runtime/payment-links-qa/session.json');
async function main() {
  const exists = fs.existsSync(file);
  let session = JSON.parse(fs.readFileSync(exists ? file : path.join(root, '.runtime/recurring-bills-qa/session.json'), 'utf8'));
  const url = new URL(session.databaseUrl);
  if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)) throw new Error('QA schema required');
  if (!exists && !process.argv.includes('--prepare')) throw new Error('Prepare QA fixture first');
  const db = new PrismaClient({ datasources: { db: { url: session.databaseUrl } } });
  try {
    if (!exists) {
      const password = `QaOnly_${randomBytes(12).toString('hex')}`;
      const fixture = await db.$transaction(async tx => {
        const user = await tx.users.create({ data: { email: `qa.links.${Date.now()}@example.test`, full_name: 'Liên kết QA', password: await bcrypt.hash(password, 10), role: 'BASIC', currency_default: 'VND', profile_setup_completed: true } });
        const wallet = await tx.wallets.create({ data: { user_id: user.id, name: 'Ví liên kết QA', currency: 'VND', balance: 690000 } });
        const category = await tx.categories.create({ data: { user_id: user.id, name: 'Hóa đơn QA', type: 'EXPENSE', cash_flow_group: 'NORMAL', is_system: false } });
        const transaction = await tx.transactions.create({ data: { wallet_id: wallet.id, category_id: category.id, currency: 'VND', amount: -310000, note: 'Internet QA', transaction_date: new Date('2026-10-28T00:00:00Z') } });
        return { userId: user.id, walletId: wallet.id, email: user.email, transactionId: transaction.id };
      });
      session = { databaseUrl: session.databaseUrl, database: session.database, jwtSecret: session.jwtSecret, ...fixture, password };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(session));
    }
    if (!/^qa\.links\.\d+@example\.test$/.test(session.email)) throw new Error('QA identity required');
    const user = await db.users.findUniqueOrThrow({ where: { id: session.userId } });
    const wallet = await db.wallets.findUniqueOrThrow({ where: { id: session.walletId } });
    if (user.email !== session.email || wallet.user_id !== user.id) throw new Error('Ownership mismatch');
    const action = process.argv.includes('--change') ? 'change' : process.argv.includes('--delete') ? 'delete' : process.argv.includes('--http') ? 'http' : null;
    let http;
    if (action) {
      const request = async (route, options = {}) => {
        const response = await fetch(`http://127.0.0.1:3000${route}`, options);
        const body = await response.json();
        return { status: response.status, body };
      };
      const login = await request('/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: session.email, password: session.password }) });
      const token = login.body.accessToken || login.body.access_token || login.body.token;
      if (login.status !== 201 || typeof token !== 'string') throw new Error('QA login failed');
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const profile = await request('/users/me', { headers });
      if (profile.status !== 200 || profile.body.id !== session.userId) throw new Error('QA profile mismatch');
      if (action !== 'http') {
        const own = await db.transactions.findFirst({ where: { id: session.transactionId, wallet_id: session.walletId } });
        if (!own) throw new Error('QA transaction not present');
        const changed = await request(`/transactions/${session.transactionId}`, { headers, method: action === 'change' ? 'PUT' : 'DELETE', ...(action === 'change' ? { body: JSON.stringify({ amount: '330000', type: 'EXPENSE', note: 'Internet QA updated' }) } : {}) });
        if (changed.status !== 200) throw new Error('QA mutation failed');
      }
      const ids = `${session.transactionId},1`;
      const linked = await request(`/transactions/linked-payments?ids=${ids}`, { headers });
      const unauthorized = await request(`/transactions/linked-payments?ids=${ids}`);
      const invalid = await request('/transactions/linked-payments?ids=1,1', { headers });
      if (linked.status !== 200 || !linked.body.missingIds.includes(1) || linked.body.data.some(row => row.id === 1) || unauthorized.status !== 401 || invalid.status !== 400) throw new Error('QA endpoint checks failed');
      http = { operation: action, linkedStatus: linked.status, unauthorized: unauthorized.status, invalidIds: invalid.status, foreignTransactionHidden: true, requestedIds: linked.body.requestedIds, missingIds: linked.body.missingIds, data: linked.body.data };
    }
    const rows = await db.transactions.findMany({ where: { wallet_id: session.walletId }, orderBy: { id: 'asc' }, select: { id: true, amount: true, note: true } });
    const finalWallet = await db.wallets.findUniqueOrThrow({ where: { id: session.walletId } });
    console.log(JSON.stringify({ fixture: 'payment-links-2026-10-28', userId: session.userId, transactionId: session.transactionId, transactionCount: rows.length, walletBalance: Number(finalWallet.balance), rows, ...(http ? { http } : {}) }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(JSON.stringify({ error: error.code || 'QA_PAYMENT_LINKS_FAILED' })); process.exitCode = 1; });
