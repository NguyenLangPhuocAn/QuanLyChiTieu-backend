const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/recurring-bills-qa/session.json'), 'utf8'));
  if (!/^nova_qa_bills_20261026_\d+$/.test(session.database)) throw new Error('Not a QA session.');
  const base = 'http://127.0.0.1:3000';
  const health = await fetch(`${base}/health`);
  if (!health.ok) throw new Error(`QA health failed: ${health.status}`);
  const login = await fetch(`${base}/users/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: session.email, password: session.password }) });
  if (!login.ok) throw new Error(`QA login failed: ${login.status}`);
  const auth = await login.json();
  const headers = { Authorization: `Bearer ${auth.accessToken || auth.token}` };
  const profile = await fetch(`${base}/users/me`, { headers });
  const wallets = await fetch(`${base}/wallets`, { headers });
  const transactions = await fetch(`${base}/transactions?type=EXPENSE&cash_flow=normal&page=1&limit=40`, { headers });
  const rows = await transactions.json();
  if (!profile.ok || !wallets.ok || !transactions.ok || rows.data?.length !== 2) throw new Error(JSON.stringify({ profileStatus: profile.status, walletsStatus: wallets.status, transactionsStatus: transactions.status, resultKeys: Object.keys(rows), message: rows.message }));
  const proof = { date: '2026-10-26', environment: 'isolated local Nest backend and MySQL QA schema', healthStatus: health.status, loginStatus: login.status, profileStatus: profile.status, walletsStatus: wallets.status, transactionsStatus: transactions.status, transactionCount: rows.data.length, authSecretsRecorded: false };
  const output = path.resolve(__dirname, '../../mobile/qa/evidence/2026-10-26-recurring');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'api-preflight.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
