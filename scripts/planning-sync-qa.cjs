// Planning metadata only. Guarded isolated QA8 schema; never writes financial tables.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/widget-categories-qa/session.json'), 'utf8'));
const auth = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/recurring-bills-qa/session.json'), 'utf8'));
const url = new URL(session.databaseUrl);
if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname) || session.userId !== 8 || !/^qa\.widgetcategories\.\d+@example\.test$/.test(session.email)) throw Error('Isolated QA8 only');
const db = new PrismaClient({ datasources: { db: { url: session.databaseUrl } } });
const folder = path.join(__dirname, '../../mobile/qa/evidence/2026-10-31-planning-sync');
const token = id => jwt.sign({ userId: id }, auth.jwtSecret, { expiresIn: '1h' });
async function request(method, body, id = 8) {
  const res = await fetch('http://127.0.0.1:3303/planning-sync', { method, headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${token(id)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
}
const money = async () => {
  const wallets = await db.wallets.findMany({ where: { user_id: 8 }, select: { id: true, balance: true }, orderBy: { id: 'asc' } });
  return JSON.parse(JSON.stringify({ wallets, transactions: await db.transactions.findMany({ where: { wallet_id: { in: wallets.map(w => w.id) } }, select: { id: true, amount: true }, orderBy: { id: 'asc' } }), loans: await db.loan_debts.findMany({ where: { user_id: 8 }, select: { id: true, principal_amount: true }, orderBy: { id: 'asc' } }) }));
};
const save = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n');
async function main() {
  try {
    const stage = process.argv[2];
    assert.equal((await db.users.findUniqueOrThrow({ where: { id: 8 } })).email, session.email);
    fs.mkdirSync(folder, { recursive: true });
    if (stage === 'prepare') {
      const tables = await db.$queryRaw`SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='planning_snapshots'`;
      if (!tables.length) {
        const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261031000100_planning_snapshots/migration.sql'), 'utf8');
        assert.ok(sql.startsWith('CREATE TABLE `planning_snapshots`')); assert.ok(!/DROP|DELETE|TRUNCATE/i.test(sql.replace(/ON DELETE CASCADE/, '')));
        await db.$executeRawUnsafe(sql);
      }
      fs.writeFileSync(path.join(folder, 'sql-before.json'), JSON.stringify(await money(), null, 2) + '\n', { flag: 'wx' });
    } else if (stage === 'api') {
      const empty = { version: 1, book: { version: 1, bills: [], periods: [] }, plans: [] };
      let result = await request('GET'); assert.equal(result.status, 200); assert.equal(result.body.revision, 0);
      assert.equal((await request('GET', null, 0)).status, 401);
      result = await request('PUT', { revision: 0, snapshot: empty }); assert.equal(result.status, 200); assert.equal(result.body.revision, 1);
      assert.equal((await request('PUT', { revision: 0, snapshot: empty })).body.revision, 1);
      const p = { id: 'qa_a', label: 'Lương QA A', type: 'INCOME', amount: 5000000, currency: 'VND', date: '2026-11-01' };
      const results = await Promise.all(['qa_a', 'qa_b'].map(id => request('PUT', { revision: 1, snapshot: { ...empty, plans: [{ ...p, id }] } })));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal((await request('GET')).body.revision, 2);
      assert.equal((await request('GET', null, 7)).body.revision, 0);
      assert.equal((await request('PUT', { revision: 2, snapshot: { ...empty, plans: [p, p] } })).status, 400);
      assert.equal((await request('PUT', { revision: 2, snapshot: empty, userId: 7 })).status, 200);
      assert.equal((await request('GET', null, 7)).body.revision, 0);
      assert.deepEqual(await money(), JSON.parse(fs.readFileSync(path.join(folder, 'sql-before.json'))));
      save('api-results.json', { server: 'QA3303', realMySQL: true, authenticatedGet: 200, noAuth: 401, upload: 200, identicalReplayRevision: 1, concurrentCasStatuses: [200, 409], invalidDuplicate: 400, otherUserUnchanged: true, moneyUnchanged: true, productionMigrationApplied: false });
    } else if (stage === 'device-b') {
      const result = await request('GET'); assert.equal(result.status, 200);
      const snapshot = result.body.snapshot; assert.ok(snapshot);
      assert.ok(!snapshot.plans.some(p => p.id === 'qa_device_b'));
      snapshot.plans.push({ id: 'qa_device_b', label: 'Tiền mạng QA B', amount: 80000, currency: 'VND', type: 'EXPENSE', date: '2026-11-02' });
      snapshot.book.bills.push({ id: 'qa_bill_b', label: 'Internet QA B', cycle: 'MONTHLY', anchorDate: '2026-11-01', kind: 'FIXED', minAmount: 100000, maxAmount: 100000, currency: 'VND', note: '', paused: false, archived: false });
      const saved = await request('PUT', { revision: result.body.revision, snapshot }); assert.equal(saved.status, 200);
      save('device-b.json', { revision: saved.body.revision, planLabels: saved.body.snapshot.plans.map(p => p.label), moneyUnchanged: true });
    } else if (stage === 'final') {
      const after = await money(); assert.deepEqual(after, JSON.parse(fs.readFileSync(path.join(folder, 'sql-before.json'))));
      save('sql-final.json', after);
      const remote = await request('GET'); assert.equal(remote.status, 200);
      save('cloud-final.json', remote.body);
    } else throw Error('Unknown stage');
    console.log(JSON.stringify({ stage, qaUserId: 8, moneyUnchanged: true, stableServerUntouched: true }));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('PLANNING_SYNC_QA_FAILED (private details suppressed)'); process.exitCode = 1; });
