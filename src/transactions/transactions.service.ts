import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, categories, transactions } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTransactionDto,
  TransactionType,
} from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

type TransactionWithCategory = transactions & {
  category?: categories | null;
};

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

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

  private normalizeTransaction(transaction: TransactionWithCategory) {
    const signedAmount = new Prisma.Decimal(transaction.amount);
    const type = this.getTypeFromSignedAmount(signedAmount);

    return {
      ...transaction,
      amount: signedAmount.abs(),
      type,
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
    const wallet = await this.prisma.wallets.findFirst({
      where: {
        id: walletId,
        user_id: userId,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    return wallet;
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

  private async attachCategories(transactions: transactions[]) {
    const categoryIds = transactions
      .map((transaction) => transaction.category_id)
      .filter((id): id is number => id !== null);

    if (categoryIds.length === 0) {
      return transactions.map((transaction) =>
        this.normalizeTransaction(transaction),
      );
    }

    const categories = await this.prisma.categories.findMany({
      where: { id: { in: categoryIds } },
    });

    const categoryMap = new Map(
      categories.map((category) => [category.id, category]),
    );

    return transactions.map((transaction) =>
      this.normalizeTransaction({
        ...transaction,
        category: transaction.category_id
          ? (categoryMap.get(transaction.category_id) ?? null)
          : null,
      }),
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
      throw new BadRequestException('Cần loại giao dịch khi thiếu danh mục');
    }

    return fallbackType;
  }

  async findAll(userId: number, walletId?: number) {
    const wallets = await this.prisma.wallets.findMany({
      where: { user_id: userId },
      select: { id: true },
    });

    const walletIds = wallets.map((wallet) => wallet.id);

    if (walletId !== undefined) {
      await this.getOwnedWallet(userId, walletId);
    }

    const transactions = await this.prisma.transactions.findMany({
      where: {
        wallet_id: walletId ?? { in: walletIds },
      },
      orderBy: { transaction_date: 'desc' },
      select: this.transactionSelect,
    });

    return this.attachCategories(transactions);
  }

  async create(userId: number, dto: CreateTransactionDto) {
    await this.getOwnedWallet(userId, dto.wallet_id);

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

      // Số tiền lưu trong database có dấu: khoản thu cộng vào ví, khoản chi trừ khỏi ví.
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

    const [normalized] = await this.attachCategories([created]);

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

    const currentWalletId = current.wallet_id;

    await this.getOwnedWallet(userId, currentWalletId);

    const nextWalletId = dto.wallet_id ?? currentWalletId;
    await this.getOwnedWallet(userId, nextWalletId);

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
      if (currentWalletId === nextWalletId) {
        await tx.wallets.update({
          where: { id: currentWalletId },
          data: {
            balance: {
              increment: nextSignedAmount.minus(currentSignedAmount),
            },
          },
        });
      } else {
        await tx.wallets.update({
          where: { id: currentWalletId },
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

    const [normalized] = await this.attachCategories([updated]);

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

    await this.getOwnedWallet(userId, current.wallet_id);

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

    const [normalized] = await this.attachCategories([deleted]);

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

    await this.getOwnedWallet(userId, current.wallet_id);

    const updated = await this.prisma.transactions.update({
      where: { id },
      data: {
        // Chỉ lưu tên file để frontend có thể ghép với domain uploads khi cần hiển thị.
        receipt_image: filename,
      },
      select: this.transactionSelect,
    });

    const [normalized] = await this.attachCategories([updated]);

    return normalized;
  }
}
