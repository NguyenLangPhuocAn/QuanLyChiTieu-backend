import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { loan_debt_status, loan_debt_type, Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanDebtDto, LoanDebtType } from './dto/create-loan-debt.dto';
import { CreateLoanDebtPaymentDto } from './dto/create-loan-debt-payment.dto';
import { UpdateLoanDebtDto } from './dto/update-loan-debt.dto';

type LoanDebtFilter = {
  type?: LoanDebtType;
  status?: 'OPEN' | 'OVERDUE' | 'PAID';
};

@Injectable()
export class LoanDebtsService {
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private positiveAmount(value: string) {
    try {
      const amount = new Prisma.Decimal(value);
      if (amount.lessThanOrEqualTo(0)) throw new Error();
      return amount;
    } catch {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }
  }

  private parseDate(value?: string | null) {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) throw new BadRequestException('Ngày không hợp lệ');
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Ngày không hợp lệ');
    }
    return date;
  }

  private async ownedWallet(userId: number, walletId: number) {
    const wallet = await this.prisma.wallets.findFirst({
      where: {
        id: walletId,
        user_id: userId,
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
      },
    });
    if (!wallet) throw new NotFoundException('Không tìm thấy ví');
    return wallet;
  }

  private categoryMeta(type: LoanDebtType, payment: boolean) {
    if (type === LoanDebtType.BORROWED) {
      return payment
        ? { name: 'Trả nợ', type: 'EXPENSE' as const }
        : { name: 'Tiền đi vay', type: 'INCOME' as const };
    }
    return payment
      ? { name: 'Thu hồi nợ', type: 'INCOME' as const }
      : { name: 'Cho vay', type: 'EXPENSE' as const };
  }

  private async ensureCategory(
    tx: Prisma.TransactionClient,
    type: LoanDebtType,
    payment: boolean,
  ) {
    const meta = this.categoryMeta(type, payment);
    const existing = await tx.categories.findFirst({
      where: {
        name: meta.name,
        type: meta.type,
        cash_flow_group: 'LOAN_DEBT',
        is_system: true,
      },
    });
    return (
      existing ??
      (await tx.categories.create({
        data: {
          name: meta.name,
          type: meta.type,
          cash_flow_group: 'LOAN_DEBT',
          is_system: true,
          is_active: true,
          icon: 'categories/icons/expense_debt_payment.png',
        },
      }))
    );
  }

  private signedAmount(
    type: LoanDebtType | loan_debt_type,
    amount: Prisma.Decimal,
    payment: boolean,
  ) {
    const isIncome = payment
      ? type === LoanDebtType.LENT
      : type === LoanDebtType.BORROWED;
    return isIncome ? amount : amount.negated();
  }

  private async conversionSnapshot(
    userId: number,
    signedAmount: Prisma.Decimal,
    walletCurrency: string,
  ) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { currency_default: true },
    });
    const source = this.currencyService.normalizeCurrency(walletCurrency);
    const target = this.currencyService.normalizeCurrency(
      user?.currency_default,
    );
    const converted = await this.currencyService.convertAmount(
      signedAmount.abs(),
      source,
      target,
    );
    return {
      currency: source,
      converted_amount: new Prisma.Decimal(converted.amount.toFixed(2)),
      converted_currency: converted.toCurrency,
      exchange_rate_used: new Prisma.Decimal(String(converted.rate)),
    };
  }

  private decorate<
    T extends {
      principal_amount: Prisma.Decimal;
      due_date: Date | null;
      status: loan_debt_status;
      payments?: Array<{
        amount: Prisma.Decimal;
        deleted_at: Date | null;
      }>;
    },
  >(record: T) {
    const settled = (record.payments ?? [])
      .filter((payment) => !payment.deleted_at)
      .reduce(
        (sum, payment) => sum.plus(payment.amount),
        new Prisma.Decimal(0),
      );
    const remaining = Prisma.Decimal.max(
      record.principal_amount.minus(settled),
      0,
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const status = remaining.equals(0)
      ? 'PAID'
      : record.due_date && record.due_date < today
        ? 'OVERDUE'
        : 'OPEN';
    return {
      ...record,
      principal_amount: Number(record.principal_amount),
      settled_amount: Number(settled),
      remaining_amount: Number(remaining),
      status,
      payments: (record.payments ?? []).filter((item) => !item.deleted_at),
    };
  }

  async findAll(userId: number, filter: LoanDebtFilter = {}) {
    const records = await this.prisma.loan_debts.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        ...(filter.type ? { type: filter.type } : {}),
      },
      include: {
        payments: {
          where: { deleted_at: null },
          orderBy: [{ payment_date: 'desc' }, { id: 'desc' }],
        },
      },
      orderBy: [{ due_date: 'asc' }, { created_at: 'desc' }],
    });
    const decorated = records.map((record) => this.decorate(record));
    return filter.status
      ? decorated.filter((record) => record.status === filter.status)
      : decorated;
  }

  async findOne(userId: number, id: number) {
    const record = await this.prisma.loan_debts.findFirst({
      where: { id, user_id: userId, deleted_at: null },
      include: {
        payments: {
          where: { deleted_at: null },
          orderBy: [{ payment_date: 'desc' }, { id: 'desc' }],
        },
      },
    });
    if (!record) throw new NotFoundException('Không tìm thấy khoản vay/nợ');
    return this.decorate(record);
  }

  async create(userId: number, dto: CreateLoanDebtDto) {
    const wallet = await this.ownedWallet(userId, dto.wallet_id);
    const principal = this.positiveAmount(dto.principal_amount);
    const signed = this.signedAmount(dto.type, principal, false);
    const snapshot = await this.conversionSnapshot(
      userId,
      signed,
      wallet.currency,
    );

    const id = await this.prisma.$transaction(async (tx) => {
      const category = await this.ensureCategory(tx, dto.type, false);
      const transaction = await tx.transactions.create({
        data: {
          wallet_id: wallet.id,
          category_id: category.id,
          amount: signed,
          ...snapshot,
          note:
            dto.note ??
            `${this.categoryMeta(dto.type, false).name}: ${dto.person_name.trim()}`,
          transaction_date: this.parseDate(dto.transaction_date) ?? new Date(),
        },
      });
      await tx.wallets.update({
        where: { id: wallet.id },
        data: { balance: { increment: signed } },
      });
      const record = await tx.loan_debts.create({
        data: {
          user_id: userId,
          person_name: dto.person_name.trim(),
          type: dto.type,
          principal_amount: principal,
          currency: wallet.currency,
          due_date: this.parseDate(dto.due_date),
          note: dto.note,
          opening_wallet_id: wallet.id,
          opening_transaction_id: transaction.id,
          status: 'OPEN',
        },
      });
      return record.id;
    });
    return this.findOne(userId, id);
  }

  private async rawRecord(userId: number, id: number) {
    const record = await this.prisma.loan_debts.findFirst({
      where: { id, user_id: userId, deleted_at: null },
    });
    if (!record) throw new NotFoundException('Không tìm thấy khoản vay/nợ');
    return record;
  }

  private async settledAmount(id: number) {
    const result = await this.prisma.loan_debt_payments.aggregate({
      where: { loan_debt_id: id, deleted_at: null },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  async addPayment(userId: number, id: number, dto: CreateLoanDebtPaymentDto) {
    const record = await this.rawRecord(userId, id);
    const settled = await this.settledAmount(id);
    const remaining = record.principal_amount.minus(settled);
    const amount = this.positiveAmount(dto.amount);
    if (amount.greaterThan(remaining)) {
      throw new BadRequestException('Số tiền vượt quá khoản còn lại');
    }
    if (remaining.lessThanOrEqualTo(0) || record.status === 'PAID') {
      throw new BadRequestException('Khoản vay/nợ đã được thanh toán');
    }
    const wallet = await this.ownedWallet(userId, dto.wallet_id);
    if (wallet.currency !== record.currency) {
      throw new BadRequestException(
        'Ví thanh toán phải cùng tiền tệ với khoản vay/nợ',
      );
    }
    const signed = this.signedAmount(record.type, amount, true);
    const snapshot = await this.conversionSnapshot(
      userId,
      signed,
      wallet.currency,
    );
    const nextStatus = amount.equals(remaining) ? 'PAID' : 'OPEN';

    await this.prisma.$transaction(async (tx) => {
      const category = await this.ensureCategory(
        tx,
        record.type as LoanDebtType,
        true,
      );
      const transaction = await tx.transactions.create({
        data: {
          wallet_id: wallet.id,
          category_id: category.id,
          amount: signed,
          ...snapshot,
          note:
            dto.note ??
            `${this.categoryMeta(record.type as LoanDebtType, true).name}: ${record.person_name}`,
          transaction_date: this.parseDate(dto.payment_date) ?? new Date(),
        },
      });
      await tx.wallets.update({
        where: { id: wallet.id },
        data: { balance: { increment: signed } },
      });
      await tx.loan_debt_payments.create({
        data: {
          loan_debt_id: id,
          wallet_id: wallet.id,
          transaction_id: transaction.id,
          amount,
          payment_date: this.parseDate(dto.payment_date) ?? new Date(),
          note: dto.note,
        },
      });
      await tx.loan_debts.update({
        where: { id },
        data: { status: nextStatus },
      });
    });
    return this.findOne(userId, id);
  }

  async update(userId: number, id: number, dto: UpdateLoanDebtDto) {
    const record = await this.rawRecord(userId, id);
    const settled = await this.settledAmount(id);
    const nextPersonName = dto.person_name?.trim();
    const personNameChanged =
      nextPersonName !== undefined && nextPersonName !== record.person_name;
    const paymentsWithGeneratedNotes = personNameChanged
      ? await this.prisma.loan_debt_payments.findMany({
          where: { loan_debt_id: id, deleted_at: null, note: null },
          select: { transaction_id: true },
        })
      : [];
    const locksOpening = settled.greaterThan(0);
    if (locksOpening && (dto.principal_amount || dto.wallet_id)) {
      throw new BadRequestException(
        'Không thể đổi số tiền hoặc ví sau khi đã có thanh toán',
      );
    }
    const nextWallet = dto.wallet_id
      ? await this.ownedWallet(userId, dto.wallet_id)
      : null;
    if (nextWallet && nextWallet.currency !== record.currency) {
      throw new BadRequestException('Ví mới phải cùng tiền tệ');
    }
    const nextPrincipal = dto.principal_amount
      ? this.positiveAmount(dto.principal_amount)
      : record.principal_amount;
    const oldSigned = this.signedAmount(
      record.type,
      record.principal_amount,
      false,
    );
    const nextSigned = this.signedAmount(record.type, nextPrincipal, false);
    const nextSnapshot =
      dto.principal_amount || dto.wallet_id
        ? await this.conversionSnapshot(
            userId,
            nextSigned,
            nextWallet?.currency ?? record.currency,
          )
        : null;

    await this.prisma.$transaction(async (tx) => {
      const openingTransactionData: Prisma.transactionsUpdateInput = {};
      if (dto.principal_amount || dto.wallet_id) {
        await tx.wallets.update({
          where: { id: record.opening_wallet_id },
          data: { balance: { decrement: oldSigned } },
        });
        await tx.wallets.update({
          where: { id: nextWallet?.id ?? record.opening_wallet_id },
          data: { balance: { increment: nextSigned } },
        });
        Object.assign(openingTransactionData, {
          wallet_id: nextWallet?.id ?? record.opening_wallet_id,
          amount: nextSigned,
          ...nextSnapshot,
        });
      }
      if (dto.note !== undefined) {
        openingTransactionData.note =
          dto.note ??
          `${this.categoryMeta(record.type as LoanDebtType, false).name}: ${nextPersonName ?? record.person_name}`;
      } else if (personNameChanged && record.note === null) {
        openingTransactionData.note = `${this.categoryMeta(record.type as LoanDebtType, false).name}: ${nextPersonName}`;
      }
      if (Object.keys(openingTransactionData).length > 0) {
        await tx.transactions.update({
          where: { id: record.opening_transaction_id },
          data: openingTransactionData,
        });
      }
      if (personNameChanged) {
        const paymentNote = `${this.categoryMeta(record.type as LoanDebtType, true).name}: ${nextPersonName}`;
        for (const payment of paymentsWithGeneratedNotes) {
          await tx.transactions.update({
            where: { id: payment.transaction_id },
            data: { note: paymentNote },
          });
        }
      }
      await tx.loan_debts.update({
        where: { id },
        data: {
          person_name: nextPersonName,
          principal_amount: dto.principal_amount ? nextPrincipal : undefined,
          opening_wallet_id: dto.wallet_id,
          due_date:
            dto.due_date !== undefined
              ? this.parseDate(dto.due_date)
              : undefined,
          note: dto.note,
        },
      });
    });
    return this.findOne(userId, id);
  }

  async removePayment(userId: number, id: number, paymentId: number) {
    await this.rawRecord(userId, id);
    const payment = await this.prisma.loan_debt_payments.findFirst({
      where: { id: paymentId, loan_debt_id: id, deleted_at: null },
    });
    if (!payment) throw new NotFoundException('Không tìm thấy lần thanh toán');
    const transaction = await this.prisma.transactions.findUnique({
      where: { id: payment.transaction_id },
    });
    if (!transaction)
      throw new NotFoundException('Không tìm thấy giao dịch liên kết');
    await this.prisma.$transaction(async (tx) => {
      await tx.wallets.update({
        where: { id: payment.wallet_id },
        data: { balance: { decrement: transaction.amount } },
      });
      await tx.transactions.delete({ where: { id: transaction.id } });
      await tx.loan_debt_payments.update({
        where: { id: payment.id },
        data: { deleted_at: new Date() },
      });
      await tx.loan_debts.update({ where: { id }, data: { status: 'OPEN' } });
    });
    return this.findOne(userId, id);
  }

  async remove(userId: number, id: number) {
    const record = await this.rawRecord(userId, id);
    const payments = await this.prisma.loan_debt_payments.findMany({
      where: { loan_debt_id: id, deleted_at: null },
    });
    const transactionIds = [
      record.opening_transaction_id,
      ...payments.map((payment) => payment.transaction_id),
    ];
    const transactions = await this.prisma.transactions.findMany({
      where: { id: { in: transactionIds } },
    });
    await this.prisma.$transaction(async (tx) => {
      for (const transaction of transactions) {
        if (!transaction.wallet_id) continue;
        await tx.wallets.update({
          where: { id: transaction.wallet_id },
          data: { balance: { decrement: transaction.amount } },
        });
      }
      await tx.transactions.deleteMany({
        where: { id: { in: transactionIds } },
      });
      await tx.loan_debt_payments.updateMany({
        where: { loan_debt_id: id, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      await tx.loan_debts.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
    });
    return { id, deleted: true };
  }
}
