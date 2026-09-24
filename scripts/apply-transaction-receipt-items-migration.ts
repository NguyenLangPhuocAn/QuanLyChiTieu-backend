import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async () => {
  const columns = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'transactions'
       AND COLUMN_NAME = 'receipt_items'`,
  );

  if (columns.length === 0) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE transactions ADD COLUMN receipt_items JSON NULL AFTER receipt_image',
    );
    console.log('MIGRATION_APPLIED=receipt_items');
  } else {
    console.log('MIGRATION_ALREADY_APPLIED=receipt_items');
  }

  const verified = await prisma.$queryRawUnsafe<
    Array<{ COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string }>
  >(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'transactions'
       AND COLUMN_NAME = 'receipt_items'`,
  );
  console.log(`VERIFIED=${JSON.stringify(verified)}`);
  const counts = await prisma.$queryRawUnsafe<
    Array<{ total: bigint; with_items: bigint; without_items: bigint }>
  >(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN receipt_items IS NOT NULL THEN 1 ELSE 0 END) AS with_items,
       SUM(CASE WHEN receipt_items IS NULL THEN 1 ELSE 0 END) AS without_items
     FROM transactions`,
  );
  console.log(
    `DATA_CHECK=${JSON.stringify(
      counts.map((row) => ({
        total: Number(row.total),
        with_items: Number(row.with_items),
        without_items: Number(row.without_items),
      })),
    )}`,
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
