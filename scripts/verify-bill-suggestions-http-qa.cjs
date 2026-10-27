const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/bill-suggestions-qa/session.json'), 'utf8'));
  if (!/^nova_qa_bills_20261026_\d+$/.test(session.database) || !/^qa\.suggestions\.\d+@example\.test$/.test(session.email)) throw new Error('Not isolated QA');
  const base = 'http://127.0.0.1:3000';
  const health = await fetch(`${base}/health`);
  const login = await fetch(`${base}/users/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: session.email, password: session.password }) });
  if (!health.ok || !login.ok) throw new Error('QA preflight failed');
  const auth = await login.json();
  const headers = { Authorization: `Bearer ${auth.accessToken || auth.token}` };
  const profile = await fetch(`${base}/users/me`, { headers });
  const profileData = await profile.json();
  const transactions = await fetch(`${base}/transactions?type=EXPENSE&cash_flow=normal&page=1&limit=100&from=2023-10-27&to=2026-10-27`, { headers });
  const data = await transactions.json();
  if (!profile.ok || profileData.id !== session.userId || !transactions.ok || data.data?.length !== 9 || data.meta?.total !== 9) throw new Error('Unexpected QA identity/history');
  const proof = { date: '2026-10-27', environment: 'isolated local Nest/MySQL source', userId: session.userId, healthStatus: health.status, loginStatus: login.status, transactionsStatus: transactions.status, transactionCount: data.data.length, complete: data.meta.totalPages === 1, authSecretsRecorded: false };
  const output = path.resolve(__dirname, '../../mobile/qa/evidence/2026-10-27-bill-suggestions');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'api-preflight.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
main().catch(() => { console.error('QA HTTP preflight failed; credentials not logged.'); process.exitCode = 1; });
