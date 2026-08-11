/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoanDebtsService } from './loan-debts.service';
import { LoanDebtType } from './dto/create-loan-debt.dto';

describe('LoanDebtsService', () => {
  const wallet = {
    id: 10,
    user_id: 1,
    currency: 'VND',
    balance: new Prisma.Decimal(1000000),
  };

  const makeService = () => {
    const tx = {
      categories: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 91 }),
      },
      transactions: {
        create: jest.fn().mockResolvedValue({ id: 201 }),
        update: jest.fn(),
      },
      wallets: { update: jest.fn() },
      loan_debts: {
        create: jest.fn().mockResolvedValue({ id: 301 }),
        update: jest.fn(),
      },
      loan_debt_payments: {
        create: jest.fn().mockResolvedValue({ id: 401 }),
        update: jest.fn(),
      },
    };
    const prisma = {
      wallets: { findFirst: jest.fn().mockResolvedValue(wallet) },
      users: {
        findUnique: jest.fn().mockResolvedValue({ currency_default: 'VND' }),
      },
      loan_debts: { findFirst: jest.fn(), findMany: jest.fn() },
      loan_debt_payments: {
        aggregate: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    } as unknown as jest.Mocked<PrismaService>;
    const currency = {
      normalizeCurrency: jest.fn((value?: string | null) => value ?? 'VND'),
      convertAmount: jest.fn(async (amount: Prisma.Decimal) => ({
        amount: Number(amount),
        toCurrency: 'VND',
        rate: 1,
      })),
    } as unknown as CurrencyService;

    return { service: new LoanDebtsService(prisma, currency), prisma, tx };
  };

  it.each([
    [LoanDebtType.BORROWED, '100000', 'increment'],
    [LoanDebtType.LENT, '-100000', 'increment'],
  ])(
    'creates %s with the correct opening wallet direction',
    async (type, signed, operation) => {
      const { service, tx } = makeService();
      (tx.categories.findFirst as jest.Mock).mockResolvedValue({ id: 90 });
      (tx.transactions.create as jest.Mock).mockResolvedValue({ id: 201 });
      (tx.loan_debts.create as jest.Mock).mockResolvedValue({ id: 301 });
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 301 } as never);

      await service.create(1, {
        person_name: 'Nguyễn Văn A',
        type,
        principal_amount: '100000',
        wallet_id: 10,
        transaction_date: '2026-06-13',
      });

      expect(tx.transactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: new Prisma.Decimal(signed) }),
        }),
      );
      expect(tx.wallets.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { balance: { [operation]: new Prisma.Decimal(signed) } },
        }),
      );
    },
  );

  it('adds a partial repayment and marks the record paid only at zero remaining', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.loan_debts.findFirst as jest.Mock).mockResolvedValue({
      id: 301,
      user_id: 1,
      type: LoanDebtType.BORROWED,
      principal_amount: new Prisma.Decimal(100000),
      currency: 'VND',
      status: 'OPEN',
      deleted_at: null,
    });
    (prisma.loan_debt_payments.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: new Prisma.Decimal(40000) },
    });
    (tx.categories.findFirst as jest.Mock).mockResolvedValue({ id: 92 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 301 } as never);

    await service.addPayment(1, 301, {
      wallet_id: 10,
      amount: '60000',
      payment_date: '2026-06-13',
    });

    expect(tx.transactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: new Prisma.Decimal(-60000) }),
      }),
    );
    expect(tx.loan_debts.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PAID' } }),
    );
  });

  it('rejects a settlement larger than the remaining amount', async () => {
    const { service, prisma } = makeService();
    (prisma.loan_debts.findFirst as jest.Mock).mockResolvedValue({
      id: 301,
      user_id: 1,
      type: LoanDebtType.LENT,
      principal_amount: new Prisma.Decimal(100000),
      currency: 'VND',
      status: 'OPEN',
      deleted_at: null,
    });
    (prisma.loan_debt_payments.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: new Prisma.Decimal(80000) },
    });

    await expect(
      service.addPayment(1, 301, { wallet_id: 10, amount: '30000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refreshes the conversion snapshot when the opening amount changes', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.loan_debts.findFirst as jest.Mock).mockResolvedValue({
      id: 301,
      user_id: 1,
      person_name: 'Nguyen Van A',
      type: LoanDebtType.BORROWED,
      principal_amount: new Prisma.Decimal(100000),
      currency: 'VND',
      opening_wallet_id: 10,
      opening_transaction_id: 201,
      status: 'OPEN',
      deleted_at: null,
    });
    (prisma.loan_debt_payments.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: null },
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 301 } as never);

    await service.update(1, 301, { principal_amount: '150000' });

    expect(tx.transactions.update).toHaveBeenCalledWith({
      where: { id: 201 },
      data: expect.objectContaining({
        amount: new Prisma.Decimal(150000),
        currency: 'VND',
        converted_amount: new Prisma.Decimal(150000),
        converted_currency: 'VND',
        exchange_rate_used: new Prisma.Decimal(1),
      }),
    });
  });

  it('updates generated transaction notes when the person name changes', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.loan_debts.findFirst as jest.Mock).mockResolvedValue({
      id: 301,
      user_id: 1,
      person_name: 'Tên cũ',
      type: LoanDebtType.BORROWED,
      principal_amount: new Prisma.Decimal(100000),
      currency: 'VND',
      note: null,
      opening_wallet_id: 10,
      opening_transaction_id: 201,
      status: 'OPEN',
      deleted_at: null,
    });
    (prisma.loan_debt_payments.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: new Prisma.Decimal(20000) },
    });
    (prisma.loan_debt_payments.findMany as jest.Mock).mockResolvedValue([
      { transaction_id: 202 },
    ]);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 301 } as never);

    await service.update(1, 301, { person_name: 'Tên mới' });

    expect(tx.transactions.update).toHaveBeenCalledWith({
      where: { id: 201 },
      data: { note: 'Tiền đi vay: Tên mới' },
    });
    expect(tx.transactions.update).toHaveBeenCalledWith({
      where: { id: 202 },
      data: { note: 'Trả nợ: Tên mới' },
    });
  });

  it('preserves custom payment notes when the person name changes', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.loan_debts.findFirst as jest.Mock).mockResolvedValue({
      id: 301,
      user_id: 1,
      person_name: 'Tên cũ',
      type: LoanDebtType.LENT,
      principal_amount: new Prisma.Decimal(100000),
      currency: 'VND',
      note: 'Ghi chú riêng',
      opening_wallet_id: 10,
      opening_transaction_id: 201,
      status: 'OPEN',
      deleted_at: null,
    });
    (prisma.loan_debt_payments.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: new Prisma.Decimal(20000) },
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 301 } as never);

    await service.update(1, 301, { person_name: 'Tên mới' });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const findManyMock = prisma.loan_debt_payments.findMany as jest.Mock;
    expect(findManyMock).toHaveBeenCalledWith({
      where: { loan_debt_id: 301, deleted_at: null, note: null },
      select: { transaction_id: true },
    });
    expect(tx.transactions.update).not.toHaveBeenCalled();
  });
});
