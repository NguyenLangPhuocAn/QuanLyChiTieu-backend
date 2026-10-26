const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

// Only a NEW local test schema. Never migrate, seed or clear the configured schema.
async function main() {
  const root = path.resolve(__dirname, '..');
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  const base = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('QA requires a local MySQL host.');
  const database = `nova_qa_bills_20261026_${Date.now()}`;
  if (!/^nova_qa_bills_20261026_\d+$/.test(database)) throw new Error('Unsafe QA schema name.');
  const argument = process.argv.indexOf('--admin-config');
  const adminUrl = new URL(base);
  if (argument !== -1) {
    const credentials = JSON.parse(fs.readFileSync(process.argv[argument + 1], 'utf8'));
    adminUrl.username = credentials.user;
    adminUrl.password = credentials.password;
    adminUrl.port = String(credentials.port);
  }
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  const qaUser = `novaqa_${Date.now()}`;
  const qaPassword = randomBytes(24).toString('hex');
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.$executeRawUnsafe(`CREATE USER '${qaUser}'@'127.0.0.1' IDENTIFIED BY '${qaPassword}'`);
    await admin.$executeRawUnsafe(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${qaUser}'@'127.0.0.1'`);
  }
  finally { await admin.$disconnect(); }
  base.username = qaUser;
  base.password = qaPassword;
  base.port = adminUrl.port;
  base.pathname = `/${database}`;
  const databaseUrl = base.toString();
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error('Could not initialize new QA schema. Original schema unchanged.');
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const password = `QaOnly_${randomBytes(10).toString('hex')}`;
    const user = await client.users.create({ data: { email: 'qa.bills@example.test', full_name: 'Nova QA Local', password: await bcrypt.hash(password, 10), role: 'BASIC', currency_default: 'VND', profile_setup_completed: true } });
    const wallet = await client.wallets.create({ data: { user_id: user.id, name: 'Ví QA local', currency: 'VND', balance: 6590000 } });
    const category = await client.categories.create({ data: { user_id: user.id, name: 'Hóa đơn QA', type: 'EXPENSE', cash_flow_group: 'NORMAL', is_system: false } });
    const now = new Date();
    const transactions = [];
    for (const [amount, note] of [[3100000, 'Thanh toán tiền nhà QA'], [310000, 'Tiền điện QA']]) {
      transactions.push(await client.transactions.create({ data: { wallet_id: wallet.id, category_id: category.id, currency: 'VND', amount: -amount, note, transaction_date: now } }));
    }
    const runtime = path.join(root, '.runtime', 'recurring-bills-qa');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'session.json'), JSON.stringify({ databaseUrl, database, email: user.email, password, userId: user.id, walletId: wallet.id, transactionIds: transactions.map(item => item.id), jwtSecret: randomBytes(32).toString('hex') }));
    console.log(JSON.stringify({ prepared: true, isolatedLocalDatabase: database, users: 1, transactions: 2, walletBalance: 6590000 }));
  } finally { await client.$disconnect(); }
}
main().catch(error => { console.error(JSON.stringify({ code: error.code, databaseCode: error.meta?.code, reason: error.meta?.message || error.message })); process.exitCode = 1; });
