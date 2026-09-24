import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async () => {
  const columns = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'notification_settings'
       AND COLUMN_NAME IN ('cashflow_forecast_enabled', 'savings_plan_alerts_enabled')`,
  );
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));
  const clauses: string[] = [];

  if (!existing.has('cashflow_forecast_enabled')) {
    clauses.push(
      'ADD COLUMN cashflow_forecast_enabled BOOLEAN DEFAULT TRUE AFTER budget_expiring_enabled',
    );
  }
  if (!existing.has('savings_plan_alerts_enabled')) {
    clauses.push(
      'ADD COLUMN savings_plan_alerts_enabled BOOLEAN DEFAULT TRUE AFTER cashflow_forecast_enabled',
    );
  }

  if (clauses.length) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE notification_settings ${clauses.join(', ')}`,
    );
    console.log(`MIGRATION_APPLIED=${clauses.length}`);
  } else {
    console.log('MIGRATION_ALREADY_APPLIED');
  }

  const verified = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'notification_settings'
       AND COLUMN_NAME IN ('cashflow_forecast_enabled', 'savings_plan_alerts_enabled')
     ORDER BY COLUMN_NAME`,
  );
  console.log(
    `VERIFIED_COLUMNS=${verified.map((column) => column.COLUMN_NAME).join(',')}`,
  );
};

main()
  .catch((error: unknown) => {
    console.error(
      `MIGRATION_FAILED=${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
