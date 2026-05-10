import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, categories, transactions } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTransactionDto,
  TransactionType,
} from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

type TransactionWithCategory = transactions & {
  category?: categories | null;
};

type OwnedWallet = {
  id: number;
  user_id: number | null;
  currency: string;
};

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private readonly transactionSelect = {
    id: true,
    wallet_id: true,
    category_id: true,
    amount: true,
    note: true,
    receipt_image: true,
    transaction_date: true,
    created_at: true,
  } as const;

  private toDecimal(value: string) {
    return new Prisma.Decimal(value);
  }

  private getTypeFromSignedAmount(amount: Prisma.Decimal) {
    return amount.greaterThanOrEqualTo(0)
      ? TransactionType.INCOME
      : TransactionType.EXPENSE;
  }

  private toSignedAmount(amount: string, type: TransactionType) {
    const decimal = this.toDecimal(amount);
    return type === TransactionType.EXPENSE ? decimal.negated() : decimal;
  }

  private async getActorCurrency(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { currency_default: true },
    });

    return this.currencyService.normalizeCurrency(user?.currency_default);
  }

  private async normalizeTransaction(
    transaction: TransactionWithCategory,
    walletCurrency: string,
    targetCurrency: string,
  ) {
    const signedAmount = new Prisma.Decimal(transaction.amount);
    const type = this.getTypeFromSignedAmount(signedAmount);
    const absoluteAmount = signedAmount.abs();
    const converted = await this.currencyService.convertAmount(
      absoluteAmount,
      walletCurrency,
      targetCurrency,
    );

    return {
      ...transaction,
      amount: absoluteAmount,
      type,
      currency: this.currencyService.normalizeCurrency(walletCurrency),
      display_amount: converted.amount,
      display_currency: converted.toCurrency,
      category: transaction.category
        ? {
            id: transaction.category.id,
            name: transaction.category.name,
            type: transaction.category.type,
            icon: transaction.category.icon,
          }
        : null,
    };
  }

  private async getOwnedWallet(userId: number, walletId: number) {
    const wallets = await this.prisma.$queryRaw<OwnedWallet[]>`
      SELECT id, user_id, currency
      FROM wallets
      WHERE id = ${walletId} AND user_id = ${userId}
      LIMIT 1
    `;
    const wallet = wallets[0];

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    return wallet satisfies OwnedWallet;
  }

  private async getAccessibleCategory(userId: number, categoryId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const category = await this.prisma.categories.findFirst({
      where:
        user?.role === 'ADMIN'
          ? { id: categoryId }
          : {
              id: categoryId,
              OR: [{ is_system: true }, { user_id: userId }],
            },
    });

    if (!category) {
      throw new NotFoundException('Không tìm thấy danh mục');
    }

    return category;
  }

  private async attachCategories(
    userId: number,
    transactionsList: transactions[],
    walletCurrencyMap: Map<number, string>,
  ) {
    const actorCurrency = await this.getActorCurrency(userId);
    const categoryIds = transactionsList
      .map((transaction) => transaction.category_id)
      .filter((id): id is number => id !== null);

    const categoriesList =
      categoryIds.length > 0
        ? await this.prisma.categories.findMany({
            where: { id: { in: categoryIds } },
          })
        : [];

    const categoryMap = new Map(
      categoriesList.map((category) => [category.id, category]),
    );

    return Promise.all(
      transactionsList.map((transaction) =>
        this.normalizeTransaction(
          {
            ...transaction,
            category: transaction.category_id
              ? (categoryMap.get(transaction.category_id) ?? null)
              : null,
          },
          walletCurrencyMap.get(transaction.wallet_id ?? 0) ?? 'VND',
          actorCurrency,
        ),
      ),
    );
  }

  private async resolveType(
    userId: number,
    categoryId?: number | null,
    fallbackType?: TransactionType,
  ) {
    if (categoryId) {
      const category = await this.getAccessibleCategory(userId, categoryId);
      return category.type as TransactionType;
    }

    if (!fallbackType) {
      throw new BadRequestException('Can loai giao dich khi thieu danh muc');
    }

    return fallbackType;
  }

  async findAll(userId: number, walletId?: number) {
    const wallets = await this.prisma.$queryRaw<Array<{ id: number; currency: string }>>`
      SELECT id, currency
      FROM wallets
      WHERE user_id = ${userId}
    `;

    const walletIds = wallets.map((wallet) => wallet.id);
    const walletCurrencyMap = new Map(
      wallets.map((wallet) => [wallet.id, wallet.currency]),
    );

    if (walletId !== undefined) {
      await this.getOwnedWallet(userId, walletId);
    }

    const transactionsList = await this.prisma.transactions.findMany({
      where: {
        wallet_id: walletId ?? { in: walletIds },
      },
      orderBy: { transaction_date: 'desc' },
      select: this.transactionSelect,
    });

    return this.attachCategories(userId, transactionsList, walletCurrencyMap);
  }

  async create(userId: number, dto: CreateTransactionDto) {
    const wallet = await this.getOwnedWallet(userId, dto.wallet_id);
    const type = await this.resolveType(userId, dto.category_id, dto.type);
    const signedAmount = this.toSignedAmount(dto.amount, type);

    const created = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transactions.create({
        data: {
          wallet_id: dto.wallet_id,
          category_id: dto.category_id,
          amount: signedAmount,
          note: dto.note,
          receipt_image: dto.receipt_image,
          transaction_date: dto.transaction_date
            ? new Date(dto.transaction_date)
            : new Date(),
        },
        select: this.transactionSelect,
      });

      await tx.wallets.update({
        where: { id: dto.wallet_id },
        data: {
          balance: {
            increment: signedAmount,
          },
        },
      });

      return transaction;
    });

    const walletCurrencyMap = new Map([[wallet.id, wallet.currency]]);
    const [normalized] = await this.attachCategories(
      userId,
      [created],
      walletCurrencyMap,
    );

    return normalized;
  }

  async update(userId: number, id: number, dto: UpdateTransactionDto) {
    const current = await this.prisma.transactions.findUnique({
      where: { id },
      select: this.transactionSelect,
    });

    if (!current || !current.wallet_id) {
      throw new NotFoundException('Không tìm thấy giao dịch');
    }

    const currentWallet = await this.getOwnedWallet(userId, current.wallet_id);
    const nextWalletId = dto.wallet_id ?? current.wallet_id;
    const nextWallet = await this.getOwnedWallet(userId, nextWalletId);

    if (
      current.wallet_id !== nextWalletId &&
      currentWallet.currency !== nextWallet.currency
    ) {
      throw new BadRequestException(
        'Không thể chuyển giao dịch sang ví có tiền tệ khác',
      );
    }

    const currentSignedAmount = new Prisma.Decimal(current.amount);
    const currentType = this.getTypeFromSignedAmount(currentSignedAmount);
    const nextType = await this.resolveType(
      userId,
      dto.category_id ?? current.category_id,
      dto.type ?? currentType,
    );
    const nextSignedAmount =
      dto.amount !== undefined
        ? this.toSignedAmount(dto.amount, nextType)
        : this.toSignedAmount(currentSignedAmount.abs().toString(), nextType);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (current.wallet_id === nextWalletId) {
        await tx.wallets.update({
          where: { id: current.wallet_id },
          data: {
            balance: {
              increment: nextSignedAmount.minus(currentSignedAmount),
            },
          },
        });
      } else {
        await tx.wallets.update({
          where: { id: current.wallet_id as number },
          data: {
            balance: {
              decrement: currentSignedAmount,
            },
          },
        });

        await tx.wallets.update({
          where: { id: nextWalletId },
          data: {
            balance: {
              increment: nextSignedAmount,
            },
          },
        });
      }

      return tx.transactions.update({
        where: { id },
        data: {
          wallet_id: nextWalletId,
          category_id: dto.category_id ?? undefined,
          amount: nextSignedAmount,
          note: dto.note ?? undefined,
          receipt_image: dto.receipt_image ?? undefined,
          transaction_date: dto.transaction_date
            ? new Date(dto.transaction_date)
            : undefined,
        },
        select: this.transactionSelect,
      });
    });

    const walletCurrencyMap = new Map([[nextWallet.id, nextWallet.currency]]);
    const [normalized] = await this.attachCategories(
      userId,
      [updated],
      walletCurrencyMap,
    );

    return normalized;
  }

  async remove(userId: number, id: number) {
    const current = await this.prisma.transactions.findUnique({
      where: { id },
      select: this.transactionSelect,
    });

    if (!current || !current.wallet_id) {
      throw new NotFoundException('Không tìm thấy giao dịch');
    }

    const wallet = await this.getOwnedWallet(userId, current.wallet_id);

    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.wallets.update({
        where: { id: current.wallet_id as number },
        data: {
          balance: {
            decrement: current.amount,
          },
        },
      });

      return tx.transactions.delete({
        where: { id },
        select: this.transactionSelect,
      });
    });

    const walletCurrencyMap = new Map([[wallet.id, wallet.currency]]);
    const [normalized] = await this.attachCategories(
      userId,
      [deleted],
      walletCurrencyMap,
    );

    return normalized;
  }

  async uploadReceipt(userId: number, id: number, filename: string) {
    const current = await this.prisma.transactions.findUnique({
      where: { id },
      select: this.transactionSelect,
    });

    if (!current || !current.wallet_id) {
      throw new NotFoundException('Không tìm thấy giao dịch');
    }

    const wallet = await this.getOwnedWallet(userId, current.wallet_id);

    const updated = await this.prisma.transactions.update({
      where: { id },
      data: {
        receipt_image: filename,
      },
      select: this.transactionSelect,
    });

    const walletCurrencyMap = new Map([[wallet.id, wallet.currency]]);
    const [normalized] = await this.attachCategories(
      userId,
      [updated],
      walletCurrencyMap,
    );

    return normalized;
  }
}
