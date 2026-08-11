import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const run = async () => {
  const notifications = await prisma.notifications.findMany({
    where: {
      source_type: 'budget',
      source_id: { not: null },
      deleted_at: null,
      type: { in: ['BUDGET_WARNING', 'BUDGET_EXCEEDED', 'BUDGET_EXPIRING'] },
    },
    select: { id: true, source_id: true, type: true },
  });
  const budgetIds = [
    ...new Set(
      notifications
        .map((item) => item.source_id)
        .filter((id): id is number => id !== null),
    ),
  ];
  const budgets = await prisma.budgets.findMany({
    where: { id: { in: budgetIds } },
    select: {
      id: true,
      name: true,
      end_date: true,
      wallet: { select: { name: true } },
    },
  });
  const budgetById = new Map(budgets.map((budget) => [budget.id, budget]));
  let updatedCount = 0;

  for (const notification of notifications) {
    const budget = notification.source_id
      ? budgetById.get(notification.source_id)
      : undefined;
    if (!budget) continue;
    const message =
      notification.type === 'BUDGET_EXCEEDED'
        ? `${budget.name} trong ${budget.wallet.name} đã vượt ngân sách.`
        : notification.type === 'BUDGET_EXPIRING'
          ? `${budget.name} trong ${budget.wallet.name} sẽ hết hạn vào ${budget.end_date.toISOString().slice(0, 10)}.`
          : `${budget.name} trong ${budget.wallet.name} đã đạt 80% ngân sách.`;
    await prisma.notifications.update({
      where: { id: notification.id },
      data: { message },
    });
    updatedCount += 1;
  }

  console.log(
    JSON.stringify(
      { scannedCount: notifications.length, updatedCount },
      null,
      2,
    ),
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
