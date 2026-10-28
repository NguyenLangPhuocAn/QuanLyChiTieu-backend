const fs = require('node:fs');
const path = require('node:path');
const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/recurring-bills-qa/session.json'), 'utf8'));
const database = new URL(session.databaseUrl);
if (database.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(database.pathname)) throw Error('Isolated QA schema required');
Object.assign(process.env, { DATABASE_URL: session.databaseUrl, PORT: '3301', HOST: '127.0.0.1', JWT_SECRET: session.jwtSecret, GEMINI_API_KEY: '', FEATURE_BANK_NOTIFICATION_AI: 'false', MAIL_HOST: '', SMTP_HOST: '', VNPAY_TMN_CODE: '', VNPAY_HASH_SECRET: '' });
require('ts-node/register/transpile-only');
require('../src/main.ts');
