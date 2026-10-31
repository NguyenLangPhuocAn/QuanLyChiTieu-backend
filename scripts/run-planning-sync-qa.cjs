// Separate development process. Never restarts stable or other QA servers.
const fs = require('node:fs'), path = require('node:path');
const session = JSON.parse(fs.readFileSync(path.join(__dirname, '../.runtime/recurring-bills-qa/session.json'), 'utf8'));
const url = new URL(session.databaseUrl);
if (url.hostname !== '127.0.0.1' || !/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)) throw Error('Isolated QA schema only');
Object.assign(process.env, { DATABASE_URL: session.databaseUrl, PORT: '3303', HOST: '127.0.0.1', JWT_SECRET: session.jwtSecret, GEMINI_API_KEY: '', FEATURE_BANK_NOTIFICATION_AI: 'false', MAIL_HOST: '', SMTP_HOST: '', VNPAY_TMN_CODE: '', VNPAY_HASH_SECRET: '' });
require('ts-node/register/transpile-only');
require('../src/main.ts');
