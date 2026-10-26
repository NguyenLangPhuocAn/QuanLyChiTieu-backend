const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
async function main() {
  const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/recurring-bills-qa/session.json'), 'utf8'));
  const url = new URL(session.databaseUrl);
  if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)) throw new Error('Only local QA schema allowed.');
  const db = new PrismaClient({ datasources: { db: { url: session.databaseUrl } } });
  try {
    const wallet = await db.wallets.findUniqueOrThrow({ where: { id: session.walletId } });
    const rows = await db.transactions.findMany({ where: { wallet_id: wallet.id }, orderBy: { id: 'asc' }, select: { id: true, amount: true, note: true } });
    const expected = rows.length === 2 && Number(wallet.balance) === 6590000
      && rows[0].id === session.transactionIds[0] && Number(rows[0].amount) === -3100000 && rows[0].note === 'Thanh toán tiền nhà QA'
      && rows[1].id === session.transactionIds[1] && Number(rows[1].amount) === -310000 && rows[1].note === 'Tiền điện QA';
    const rotations = await db.refresh_tokens.count({ where: { user_id: session.userId, revoked_at: { not: null } } });
    console.log(JSON.stringify({ qaDatabase: session.database, walletBalance: Number(wallet.balance), transactionCount: rows.length, transactions: rows.map(row => ({ id: row.id, amount: Number(row.amount), note: row.note })), refreshRotationCount: rotations, originalSeedUnchanged: expected }));
    if (!expected) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
