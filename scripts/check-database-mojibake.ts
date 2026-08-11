import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { findMojibakeReason } from '../src/common/text/mojibake-scanner';

const loadDatabaseUrl = () => {
  if (process.env.DATABASE_URL) {
    return;
  }

  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    throw new Error('Không tìm thấy DATABASE_URL hoặc file .env');
  }

  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((item) => item.startsWith('DATABASE_URL='));

  if (!line) {
    throw new Error('Không tìm thấy DATABASE_URL trong file .env');
  }

  process.env.DATABASE_URL = line
    .slice('DATABASE_URL='.length)
    .trim()
    .replace(/^['"]|['"]$/g, '');
};

loadDatabaseUrl();

const prisma = new PrismaClient();
const targets: Record<string, string[]> = {
  admin_logs: ['action'],
  budgets: ['name'],
  categories: ['name', 'icon'],
  loan_debts: ['person_name', 'note'],
  loan_debt_payments: ['note'],
  notification_broadcasts: ['title', 'message'],
  notifications: ['title', 'message'],
  tags: ['name'],
  transactions: ['note'],
  users: ['full_name', 'address'],
  wallets: ['name'],
};

type TextRow = { id: number; value: string | null };

const run = async () => {
  const databaseInfo = await prisma.$queryRawUnsafe<
    Array<{ charset: string; collation: string }>
  >(
    'SELECT @@character_set_database AS charset, @@collation_database AS collation',
  );
  const findings: Array<{
    table: string;
    column: string;
    count: number;
    sampleIds: number[];
    reasons: string[];
  }> = [];

  for (const [table, columns] of Object.entries(targets)) {
    for (const column of columns) {
      const rows = await prisma.$queryRawUnsafe<TextRow[]>(
        `SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`,
      );
      const suspicious = rows
        .map((row) => ({ ...row, reason: findMojibakeReason(row.value) }))
        .filter((row) => row.reason !== null);

      if (suspicious.length > 0) {
        findings.push({
          table,
          column,
          count: suspicious.length,
          sampleIds: suspicious.slice(0, 10).map((row) => row.id),
          reasons: [...new Set(suspicious.map((row) => row.reason as string))],
        });
      }
    }
  }

  const summary = {
    database: databaseInfo[0],
    checkedColumns: Object.values(targets).reduce(
      (total, columns) => total + columns.length,
      0,
    ),
    findingCount: findings.reduce((total, finding) => total + finding.count, 0),
    findings,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.findingCount > 0) {
    process.exitCode = 1;
  }
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
