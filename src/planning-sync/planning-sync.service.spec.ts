import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PlanningSyncService,
  validatePlanningPayload,
} from './planning-sync.service';
import { PlanningSyncController } from './planning-sync.module';
import { PrismaService } from '../prisma/prisma.service';

const empty = () => ({
  version: 1,
  book: { version: 1, bills: [], periods: [] },
  plans: [],
});
const bill = {
  id: 'bill1',
  label: 'Internet',
  anchorDate: '2026-01-31',
  cycle: 'MONTHLY',
  currency: 'VND',
  kind: 'FIXED',
  minAmount: 100000,
  maxAmount: 100000,
  note: '',
  paused: false,
  archived: false,
};
const plan = {
  id: 'salary',
  label: 'Lương',
  date: '2026-11-01',
  type: 'INCOME',
  currency: 'VND',
  amount: 5000000,
};
describe('planning payload validation', () => {
  const full = () => ({
    ...empty(),
    book: {
      version: 1,
      bills: [bill],
      periods: [{ billId: bill.id, dueDate: '2026-02-28', status: 'SKIPPED' }],
    },
    plans: [plan],
  });
  it('accepts empty and real monthly schedules with February clamping', () => {
    expect(JSON.parse(validatePlanningPayload(full()))).toEqual(full());
    expect(() => validatePlanningPayload(empty())).not.toThrow();
  });
  it.each([
    (v: ReturnType<typeof full>) => {
      v.plans.push(plan);
    },
    (v: ReturnType<typeof full>) => {
      v.plans[0] = { ...plan, amount: -1 };
    },
    (v: ReturnType<typeof full>) => {
      v.plans[0] = { ...plan, date: '2026-02-30' };
    },
    (v: ReturnType<typeof full>) => {
      v.book.bills.push(bill);
    },
    (v: ReturnType<typeof full>) => {
      v.book.bills[0] = { ...bill, note: 'x'.repeat(501) };
    },
    (v: ReturnType<typeof full>) => {
      v.book.bills[0] = { ...bill, minAmount: 1.5 };
    },
    (v: ReturnType<typeof full>) => {
      v.book.periods[0].dueDate = '2026-03-28';
    },
    (v: ReturnType<typeof full>) => {
      v.book.periods[0].billId = 'unknown';
    },
  ])(
    'rejects invalid, duplicate or orphan entries before database access %#',
    (mutate) => {
      const value = full();
      mutate(value);
      expect(() => validatePlanningPayload(value)).toThrow(BadRequestException);
    },
  );
  it('rejects oversized, unknown top fields and malformed alert evidence', () => {
    expect(() => validatePlanningPayload({ ...empty(), secret: true })).toThrow(
      BadRequestException,
    );
    expect(() =>
      validatePlanningPayload({ ...empty(), plans: Array(2001).fill(plan) }),
    ).toThrow(BadRequestException);
    expect(() =>
      validatePlanningPayload({
        ...empty(),
        book: { ...empty().book, reviewedAlerts: ['bad'] },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validatePlanningPayload({
        ...empty(),
        plans: [{ ...plan, padding: 'x'.repeat(524288) }],
      }),
    ).toThrow(BadRequestException);
  });
});
describe('planning compare-and-set storage', () => {
  let service: PlanningSyncService;
  const rows = new Map<
    number,
    { revision: number; payload: unknown; updated_at: Date }
  >();
  const query = jest.fn((_sql: TemplateStringsArray, id: number) =>
    Promise.resolve(rows.has(id) ? [rows.get(id)] : []),
  );
  const execute = jest.fn(
    async (
      sql: TemplateStringsArray,
      a: number | string,
      b: number | string,
      c?: number,
    ) => {
      await Promise.resolve();
      if (sql.join('').includes('INSERT')) {
        if (rows.has(Number(a))) return 0;
        rows.set(Number(a), {
          revision: 1,
          payload: JSON.parse(String(b)),
          updated_at: new Date(),
        });
        return 1;
      }
      const row = rows.get(Number(b));
      if (!row || row.revision !== c) return 0;
      rows.set(Number(b), {
        revision: c + 1,
        payload: JSON.parse(String(a)),
        updated_at: new Date(),
      });
      return 1;
    },
  );
  beforeEach(() => {
    rows.clear();
    jest.clearAllMocks();
    const db = {
      $queryRaw: query,
      $transaction: async (fn: (tx: unknown) => unknown) =>
        await fn({ $queryRaw: query, $executeRaw: execute }),
    };
    service = new PlanningSyncService(db as unknown as PrismaService);
  });
  it('isolates users and returns revision zero only for the requested user', async () => {
    expect((await service.get(7)).revision).toBe(0);
    await service.put(8, { revision: 0, snapshot: empty() });
    expect((await service.get(8)).revision).toBe(1);
    expect((await service.get(7)).snapshot).toBeNull();
    expect(query.mock.calls.at(-1)?.[1]).toBe(7);
  });
  it('accepts idempotent lost acknowledgement but rejects stale different content', async () => {
    await service.put(8, { revision: 0, snapshot: empty() });
    expect(
      (await service.put(8, { revision: 0, snapshot: empty() })).revision,
    ).toBe(1);
    await expect(
      service.put(8, { revision: 0, snapshot: { ...empty(), plans: [plan] } }),
    ).rejects.toThrow(ConflictException);
    expect((await service.get(8)).snapshot).toEqual(empty());
    expect(
      (
        await service.put(8, {
          revision: 1,
          snapshot: { ...empty(), plans: [plan] },
        })
      ).revision,
    ).toBe(2);
  });
  it.each([undefined, -1, 0.5, 2147483647])(
    'rejects revision %s without database writes',
    async (revision) => {
      await expect(
        service.put(8, { revision, snapshot: empty() }),
      ).rejects.toThrow(BadRequestException);
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it('returns rollout unavailable when the new table is absent', async () => {
    query.mockRejectedValueOnce({ meta: { code: '1146' } });
    await expect(service.get(8)).rejects.toThrow(ServiceUnavailableException);
  });
  it('controller takes identity only from the authenticated request', async () => {
    const controller = new PlanningSyncController(service);
    const req = { user: { userId: 8 } } as Parameters<typeof controller.put>[0];
    await controller.put(req, { revision: 0, snapshot: empty(), userId: 7 });
    expect((await service.get(8)).revision).toBe(1);
    expect((await service.get(7)).revision).toBe(0);
  });
});
