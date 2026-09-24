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
      $queryRaw: jest.fn(),
      categories: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 91 }),
      },
      transactions: {
        create: jest.fn().mockResolvedValue({ id: 201 }),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      wallets: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      loan_debts: {
        create: jest.fn().mockResolvedValue({ id: 301 }),
        update: jest.fn(),
      },
      loan_debt_payments: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
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
    tx.$queryRaw.mockImplementation(async () => [
      await prisma.loan_debts.findFirst({ where: { id: 301 } }),
    ]);
    tx.loan_debt_payments.aggregate.mockImplementation(() =>
      prisma.loan_debt_payments.aggregate({
        where: { loan_debt_id: 301 },
        _sum: { amount: true },
      }),
    );
    tx.loan_debt_payments.findMany.mockImplementation(
      (args: Prisma.loan_debt_paymentsFindManyArgs) =>
        prisma.loan_debt_payments.findMany(args),
    );
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
          data: expect.objectContaining({
            amount: new Prisma.Decimal(signed),
            transaction_date: new Date('2026-06-13T00:00:00.000Z'),
          }),
        }),
      );
      expect(tx.wallets.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { balance: { [operation]: new Prisma.Decimal(signed) } },
        }),
      );
    },
  );

  it.each(['2026-02-30', '2026-13-01', '2026-00-01', '2026-06-00'])(
    'rejects an impossible calendar date %s instead of moving it to another month',
    async (transaction_date) => {
      const { service, tx } = makeService();
      await expect(
        service.create(1, {
          person_name: 'A',
          type: LoanDebtType.BORROWED,
          principal_amount: '100',
          wallet_id: 10,
          transaction_date,
        }),
      ).rejects.toThrow('Ngày không hợp lệ');
      expect(tx.wallets.updateMany).not.toHaveBeenCalled();
    },
  );

  it('does not let a loan change the balance of a goal-managed savings wallet', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.wallets.findFirst as jest.Mock).mockResolvedValue({
      ...wallet,
      wallet_type: 'SAVINGS',
    });
    await expect(
      service.create(1, {
        person_name: 'A',
        type: LoanDebtType.LENT,
        principal_amount: '100',
        wallet_id: 10,
      }),
    ).rejects.toThrow('rút tiền về ví thông thường');
    expect(tx.wallets.updateMany).not.toHaveBeenCalled();
  });

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

  it.each(['overpayment', 'principal_edit', 'final_payment'] as const)(
    'uses the locked payment total for %s',
    async (scenario) => {
      const { service, prisma, tx } = makeService();
      (prisma.loan_debts.findFirst as jest.Mock).mockResolvedValue({
        id: 301,
        user_id: 1,
        type: LoanDebtType.BORROWED,
        principal_amount: new Prisma.Decimal(100000),
        currency: 'VND',
        opening_wallet_id: 10,
        status: 'OPEN',
        deleted_at: null,
      });
      (prisma.loan_debt_payments.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal(0) },
      });
      tx.loan_debt_payments.aggregate.mockResolvedValue({
        _sum: {
          amount: new Prisma.Decimal(
            scenario === 'final_payment' ? 40000 : 70000,
          ),
        },
      });
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 301 } as never);
      if (scenario === 'final_payment') {
        await service.addPayment(1, 301, { wallet_id: 10, amount: '60000' });
        expect(tx.loan_debts.update).toHaveBeenCalledWith({
          where: { id: 301 },
          data: { status: 'PAID' },
        });
      } else {
        const operation =
          scenario === 'principal_edit'
            ? service.update(1, 301, { principal_amount: '150000' })
            : service.addPayment(1, 301, { wallet_id: 10, amount: '60000' });
        await expect(operation).rejects.toThrow(
          scenario === 'principal_edit'
            ? 'sau khi đã có thanh toán'
            : 'vượt quá khoản còn lại',
        );
        expect(tx.wallets.updateMany).not.toHaveBeenCalled();
      }
    },
  );

  it('does not refund a payment deleted while waiting for the loan lock', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.loan_debts.findFirst as jest.Mock).mockResolvedValue({ id: 301 });
    tx.loan_debt_payments.findFirst.mockResolvedValue(null);
    await expect(service.removePayment(1, 301, 401)).rejects.toThrow(
      'Không tìm thấy lần thanh toán',
    );
    expect(tx.wallets.updateMany).not.toHaveBeenCalled();
    expect(tx.transactions.delete).not.toHaveBeenCalled();
  });

  it('rejects an opening loan when the wallet changed before the balance write', async () => {
    const { service, tx } = makeService();
    tx.wallets.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.create(1, {
        person_name: 'A',
        type: LoanDebtType.BORROWED,
        principal_amount: '100',
        wallet_id: 10,
      }),
    ).rejects.toThrow('Ví vừa thay đổi');
    expect(tx.loan_debts.create).not.toHaveBeenCalled();
    expect(tx.wallets.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 10,
          user_id: 1,
          currency: 'VND',
          deleted_at: null,
        }),
      }),
    );
  });

  it('does not reverse balances again when the loan was already deleted', async () => {
    const { service, tx } = makeService();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.remove(1, 301)).rejects.toThrow(
      'Không tìm thấy khoản vay/nợ',
    );
    expect(tx.wallets.updateMany).not.toHaveBeenCalled();
    expect(tx.transactions.deleteMany).not.toHaveBeenCalled();
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
