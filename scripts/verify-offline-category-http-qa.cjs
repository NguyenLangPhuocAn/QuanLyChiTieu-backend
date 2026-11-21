// Run only against the existing isolated QA schema and loopback QA API.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/recurring-bills-qa/session.json'), 'utf8'));
const url = new URL(session.databaseUrl);
if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname) || session.email !== 'qa.bills@example.test') throw Error('Isolated QA schema required');
const base = 'http://127.0.0.1:3303';
const requestKey = `category_${Date.now()}_qa_offline`;
const db = new PrismaClient({ datasources: { db: { url: session.databaseUrl } } });

async function call(route, method, token, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const user = await db.users.findUniqueOrThrow({ where: { id: session.userId } });
  try {
    await db.users.update({ where: { id: user.id }, data: { role: 'PREMIUM' } });
    const login = await call('/users/login', 'POST', null, { email: session.email, password: session.password });
    if (login.status !== 200 && login.status !== 201) throw Error(`QA login ${login.status}`);
    const token = login.body.accessToken ?? login.body.token ?? login.body.data?.accessToken;
    if (!token) throw Error('QA login missing token');

    const input = { name: 'QA offline category', type: 'EXPENSE', client_request_id: requestKey };
    const first = await call('/categories', 'POST', token, input);
    const again = await call('/categories', 'POST', token, input);
    const changedKey = await call('/categories', 'POST', token, { ...input, name: 'QA different category' });
    if (first.status !== 201 || again.status !== 201 || first.body.id !== again.body.id || changedKey.status !== 409) throw Error('Create idempotency failed');

    const original = { name: first.body.name, type: first.body.type, cash_flow_group: first.body.cash_flow_group, icon: first.body.icon ?? null };
    const updated = await call(`/categories/${first.body.id}`, 'PUT', token, { name: 'QA offline category updated', offline_expected: original });
    const staleUpdate = await call(`/categories/${first.body.id}`, 'PUT', token, { name: 'QA stale update', offline_expected: original });
    const staleDelete = await call(`/categories/${first.body.id}`, 'DELETE', token, { offline_expected: original });
    if (updated.status !== 200 || staleUpdate.status !== 409 || staleDelete.status !== 409) throw Error('Stale write guard failed');

    const current = { name: updated.body.name, type: updated.body.type, cash_flow_group: updated.body.cash_flow_group, icon: updated.body.icon ?? null };
    const deleted = await call(`/categories/${first.body.id}`, 'DELETE', token, { offline_expected: current });
    const rows = await db.categories.findMany({ where: { user_id: user.id, client_request_id: requestKey } });
    if (deleted.status !== 200 || rows.length !== 1 || rows[0].is_active !== false) throw Error('Conditional delete failed');
    console.log(JSON.stringify({ qaOnly: true, createStatus: first.status, repeatedIdSame: first.body.id === again.body.id, reusedKeyStatus: changedKey.status, updateStatus: updated.status, staleUpdateStatus: staleUpdate.status, staleDeleteStatus: staleDelete.status, deleteStatus: deleted.status, rowsForRequest: rows.length }));
  } finally {
    await db.users.update({ where: { id: user.id }, data: { role: user.role } });
    await db.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
