import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const run = async () => {
  const openingTransactions = await prisma.$executeRaw`
    UPDATE transactions AS transaction_row
    INNER JOIN loan_debts AS loan_debt
      ON loan_debt.opening_transaction_id = transaction_row.id
    SET transaction_row.note = COALESCE(
      loan_debt.note,
      CONCAT(
        CASE loan_debt.type
          WHEN 'BORROWED' THEN 'Tiền đi vay'
          ELSE 'Cho vay'
        END,
        ': ',
        loan_debt.person_name
      )
    )
    WHERE loan_debt.deleted_at IS NULL
  `;

  const paymentTransactions = await prisma.$executeRaw`
    UPDATE transactions AS transaction_row
    INNER JOIN loan_debt_payments AS payment
      ON payment.transaction_id = transaction_row.id
    INNER JOIN loan_debts AS loan_debt
      ON loan_debt.id = payment.loan_debt_id
    SET transaction_row.note = CONCAT(
      CASE loan_debt.type
        WHEN 'BORROWED' THEN 'Trả nợ'
        ELSE 'Thu hồi nợ'
      END,
      ': ',
      loan_debt.person_name
    )
    WHERE loan_debt.deleted_at IS NULL
      AND payment.deleted_at IS NULL
      AND payment.note IS NULL
  `;

  console.log(
    JSON.stringify({ openingTransactions, paymentTransactions }, null, 2),
  );
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
