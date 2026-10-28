import { Prisma } from '@prisma/client';
import { PersonalBackupService } from './personal-backup.service';

describe('PersonalBackupService preview', () => {
  const makeFile = (transactions: unknown[]) =>
    Buffer.from(
      JSON.stringify({
        format: 'SO_THU_CHI_NOVA_PERSONAL_BACKUP',
        version: 1,
        createdAt: '2026-10-18T00:00:00.000Z',
        dataTypes: ['transactions'],
        source: { app: 'Sổ Thu Chi Nova', userIdHash: 'hash' },
        wallets: [],
        categories: [],
        transactions,
      }),
      'utf8',
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

  it('marks repeated rows inside the same file duplicate and does not write during preview', async () => {
    const result = await createService().preview(
      1,
      makeFile([baseRow, baseRow]),
    );
    expect(result.rows.map((row) => row.status)).toEqual([
      'READY',
      'DUPLICATE',
    ]);
    expect(result.metadata.fileHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects malformed files and marks malformed rows invalid without crashing', async () => {
    const service = createService();
    for (const text of ['null', '{}', 'not json'])
      await expect(service.preview(1, Buffer.from(text))).rejects.toThrow();
    const result = await service.preview(
      1,
      makeFile([
        null,
        {},
        { ...baseRow, amount: 'NaN' },
        { ...baseRow, amount: '1.5' },
        { ...baseRow, transactionDate: 'invalid' },
        { ...baseRow, tags: [{}] },
      ]),
    );
    expect(result.summary.invalid).toBe(6);
  });

  it('rejects a changed file before any DB read or write and restores selected rows with stable request IDs', async () => {
    const service = createService();
    const create = jest.fn().mockResolvedValue({ id: 100 });
    Object.assign(service, { transactionsService: { create } });
    const file = makeFile([baseRow, { ...baseRow, amount: '80000' }]);
    const preview = await service.preview(1, file);
    await expect(
      service.restore(
        1,
        Buffer.concat([file, Buffer.from(' ')]),
        new Set([1]),
        preview.metadata.fileHash,
      ),
    ).rejects.toThrow('thay đổi');
    expect(create).not.toHaveBeenCalled();
    expect(
      await service.restore(1, file, new Set([2]), preview.metadata.fileHash),
    ).toMatchObject({ restored: 1, failed: 0 });
    expect(create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        wallet_id: 10,
        category_id: 20,
        amount: '80000.00',
        transaction_date: '2026-10-18',
      }),
    );
    expect((create.mock.calls as unknown[][])[0][1]).toHaveProperty(
      'client_request_id',
      `backup_${preview.metadata.fileHash.slice(0, 40)}_2`,
    );
  });

  it('exports readable UTF8 JSON and preserves tags and receipt items', async () => {
    const prisma = {
      wallets: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 10, name: 'Tiền mặt', currency: 'VND', wallet_type: 'CASH' },
          ]),
      },
      categories: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 20,
            name: 'Ăn uống',
            type: 'EXPENSE',
            cash_flow_group: 'NORMAL',
            is_system: false,
          },
        ]),
      },
      transactions: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            wallet_id: 10,
            category_id: 20,
            amount: new Prisma.Decimal(-79000),
            note: 'Cà phê',
            transaction_date: new Date(baseRow.transactionDate),
            receipt_items: [{ name: 'Bạc xỉu', amount: 94000 }],
          },
        ]),
      },
      transaction_tags: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ transaction_id: 1, tag_id: 7 }]),
      },
      tags: {
        findMany: jest.fn().mockResolvedValue([{ id: 7, name: 'ăn uống' }]),
      },
    };
    const result = await new PersonalBackupService(
      prisma as never,
      {} as never,
    ).export(1);
    const payload = JSON.parse(
      Buffer.from(result.base64, 'base64').toString('utf8'),
    ) as { transactions: unknown[]; ciphertext?: unknown; format: string };
    expect(payload.transactions[0]).toMatchObject({
      note: 'Cà phê',
      tags: ['ăn uống'],
      receiptItems: [{ name: 'Bạc xỉu', amount: 94000 }],
    });
    expect(payload.ciphertext).toBeUndefined();
    expect(payload.format).toBe('SO_THU_CHI_NOVA_PERSONAL_BACKUP');
  });
});
