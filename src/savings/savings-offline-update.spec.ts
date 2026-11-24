import { ConflictException } from '@nestjs/common';
import { Prisma, savings_goal_status } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { SavingsService } from './savings.service';

const original = {
  name: 'Quỹ dự phòng',
  target_amount: '2000000.00',
  target_date: null,
  note: null,
  status: savings_goal_status.ACTIVE,
};
const goal = (name = original.name) => ({
  id: 4,
  user_id: 7,
  wallet_id: 9,
  name,
  target_amount: new Prisma.Decimal(original.target_amount),
  target_date: null,
  note: null,
  status: savings_goal_status.ACTIVE,
  deleted_at: null,
  wallet: { id: 9, balance: new Prisma.Decimal(0) },
  entries: [],
});
const setup = (serverGoal = goal()) => {
  const tx = {
    savings_goals: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    wallets: { update: jest.fn() },
  };
  const transaction = jest.fn(
    (action: (client: typeof tx) => Promise<unknown>) => action(tx),
  );
  const prisma = {
    savings_goals: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { NOT?: unknown } }) =>
          Promise.resolve(where.NOT ? null : serverGoal),
        ),
    },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new SavingsService(prisma, {} as CurrencyService);
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 4 } as never);
  return { service, transaction, tx };
};

describe('SavingsService reviewed offline metadata update', () => {
  it('rejects a server change before starting a write', async () => {
    const { service, transaction, tx } = setup(goal('Quỹ gia đình'));
    await expect(
      service.updateGoal(7, 4, {
        name: 'Quỹ học tập',
        offline_expected: original,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.wallets.update).not.toHaveBeenCalled();
  });

  it('rejects a change made during the write without renaming the savings wallet', async () => {
    const { service, tx } = setup();
    tx.savings_goals.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateGoal(7, 4, {
        name: 'Quỹ học tập',
        offline_expected: original,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.wallets.update).not.toHaveBeenCalled();
    expect(tx.savings_goals.update).not.toHaveBeenCalled();
  });

  it('updates only the reviewed goal fields and its wallet name', async () => {
    const { service, tx } = setup();
    await service.updateGoal(7, 4, {
      name: 'Quỹ học tập',
      offline_expected: original,
    });
    expect(tx.savings_goals.updateMany).toHaveBeenCalledWith({
      where: {
        id: 4,
        user_id: 7,
        deleted_at: null,
        name: 'Quỹ dự phòng',
        target_amount: new Prisma.Decimal('2000000.00'),
        target_date: null,
        note: null,
        status: savings_goal_status.ACTIVE,
      },
      data: { name: 'Quỹ học tập' },
    });
    expect(tx.wallets.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { name: 'Tiết kiệm - Quỹ học tập' },
    });
  });
});
