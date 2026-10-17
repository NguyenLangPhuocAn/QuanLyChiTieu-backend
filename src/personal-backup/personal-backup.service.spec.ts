import { Prisma } from '@prisma/client';
import { encryptPersonalBackup } from './personal-backup.crypto';
import { PersonalBackupService } from './personal-backup.service';

describe('PersonalBackupService preview', () => {
  const password = 'mat-khau-rat-manh';
  const makeFile = (transactions: unknown[]) =>
    encryptPersonalBackup(
      {
        format: 'SO_THU_CHI_NOVA_PERSONAL_BACKUP',
        version: 1,
        createdAt: '2026-10-18T00:00:00.000Z',
        dataTypes: ['transactions'],
        source: { app: 'Sổ Thu Chi Nova', userIdHash: 'hash' },
        wallets: [],
        categories: [],
        transactions,
      },
      password,
    );

  const baseRow = {
    row: 1,
    wallet: { name: 'Tiền mặt', currency: 'VND' },
    category: {
      name: 'Ăn uống',
      type: 'EXPENSE',
      cashFlowGroup: 'NORMAL',
    },
    type: 'EXPENSE',
    amount: '79000.00',
    note: 'Cà phê',
    transactionDate: '2026-10-18T08:00:00.000Z',
    receiptItems: null,
    tags: ['ăn uống'],
  };

  const createService = (existing: unknown[] = []) => {
    const prisma = {
      wallets: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 10, name: 'Tiền mặt', currency: 'VND' }]),
      },
      categories: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 20,
            name: 'Ăn uống',
            type: 'EXPENSE',
            cash_flow_group: 'NORMAL',
          },
          {
            id: 21,
            name: 'Chuyển ví',
            type: 'EXPENSE',
            cash_flow_group: 'TRANSFER',
          },
        ]),
      },
      transactions: { findMany: jest.fn().mockResolvedValue(existing) },
    };
    return new PersonalBackupService(prisma as never, {} as never);
  };

  it('requires matching wallets/categories and marks an exact existing row duplicate', async () => {
    const existing = [
      {
        wallet_id: 10,
        amount: new Prisma.Decimal('-79000.00'),
        transaction_date: new Date(baseRow.transactionDate),
        note: baseRow.note,
      },
    ];
    const result = await createService(existing).preview(
      1,
      makeFile([
        baseRow,
        { ...baseRow, row: 2, amount: '80000.00' },
        {
          ...baseRow,
          row: 3,
          category: {
            name: 'Chuyển ví',
            type: 'EXPENSE',
            cashFlowGroup: 'TRANSFER',
          },
        },
      ]),
      password,
    );

    expect(result.summary).toEqual({
      total: 3,
      ready: 1,
      duplicate: 1,
      invalid: 1,
    });
    expect(result.rows.map((row) => row.status)).toEqual([
      'DUPLICATE',
      'READY',
      'INVALID',
    ]);
    expect(result.rows[2].reason).toContain('luồng chuyên biệt');
  });
});
