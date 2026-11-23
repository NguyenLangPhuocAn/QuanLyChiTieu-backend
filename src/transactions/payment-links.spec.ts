import { Prisma } from '@prisma/client';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import {
  parsePaymentLinkIds,
  validatePaymentLinkIds,
} from './payment-link-ids';
import type { PrismaService } from '../prisma/prisma.service';
import type { CurrencyService } from '../currency/currency.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ReceiptOcrService } from './receipt-ocr.service';

describe('linked payment verification', () => {
  it('rejects empty, repeated, unbounded, non-integer and injected IDs', () => {
    for (const input of [
      undefined,
      '',
      '1,,2',
      '1 OR 1=1',
      '-1',
      '0',
      '1.5',
      '1,1',
      '1,01',
      '2147483648',
      Array.from({ length: 101 }, (_, i) => i + 1).join(','),
    ])
      expect(() => parsePaymentLinkIds(input)).toThrow();
    expect(parsePaymentLinkIds('3,12')).toEqual([3, 12]);
    expect(() => validatePaymentLinkIds([NaN])).toThrow();
  });
  it('controller passes the authenticated user and validated exact IDs', () => {
    const service = { linkedPayments: jest.fn().mockReturnValue('safe') };
    const controller = new TransactionsController(
      service as unknown as TransactionsService,
      {} as ReceiptOcrService,
    );
    expect(
      controller.linkedPayments({ user: { userId: 44 } } as never, '3,12'),
    ).toBe('safe');
    expect(service.linkedPayments).toHaveBeenCalledWith(44, [3, 12]);
  });
  it('loads owner-scoped payments and tags only for transactions returned by that query', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 3,
          wallet_id: 2,
          amount: new Prisma.Decimal('260000'),
          currency: 'VND',
          transaction_date: new Date('2026-10-29T00:00:00Z'),
          note: 'Đã sửa sang thu',
          receipt_image: null,
          receipt_items: null,
          category_id: 5,
          category_name: 'Vay',
          category_type: 'INCOME',
          cash_flow_group: 'LOAN_DEBT',
        },
      ])
      .mockResolvedValueOnce([{ transaction_id: 3, name: 'Gia đình' }]);
    const service = new TransactionsService(
      { $queryRaw: query } as unknown as PrismaService,
      {} as CurrencyService,
      {} as NotificationsService,
    );
    const result = await service.linkedPayments(44, [3, 12]);
    expect(query).toHaveBeenCalledTimes(2);
    const sql = query.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql[0].join('?')).toContain('WHERE w.user_id = ? AND t.id IN (?)');
    expect(sql[1]).toBe(44);
    expect((sql[2] as Prisma.Sql).values).toEqual([3, 12]);
    const tagSql = query.mock.calls[1] as [TemplateStringsArray, ...unknown[]];
    expect(tagSql[0].join('?')).toContain('WHERE tt.transaction_id IN (?)');
    expect((tagSql[1] as Prisma.Sql).values).toEqual([3]);
    expect(result.requestedIds).toEqual([3, 12]);
    expect(result.missingIds).toEqual([12]);
    expect(result.data[0]).toMatchObject({
      id: 3,
      amount: '260000',
      type: 'INCOME',
      transaction_date: '2026-10-29T00:00:00.000Z',
      category: { cash_flow_group: 'LOAN_DEBT' },
    });
    expect(result.data[0]).toMatchObject({
      receipt_image: null,
      receipt_items: null,
      tags: ['Gia đình'],
    });
  });
  it('returns indistinguishable missing IDs when no accessible transactions exist', async () => {
    const service = new TransactionsService(
      {
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService,
      {} as CurrencyService,
      {} as NotificationsService,
    );
    expect(await service.linkedPayments(44, [3, 12])).toEqual({
      requestedIds: [3, 12],
      missingIds: [3, 12],
      data: [],
    });
  });
});
