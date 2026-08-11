import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, categories, transactions } from '@prisma/client';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join, normalize } from 'path';
import { CurrencyService } from '../currency/currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTransactionDto,
  TransactionType,
} from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

type TransactionWithCategory = transactions & {
  category?: categories | null;
  tags?: string[];
};

type TransactionMoneyFields = Pick<
  transactions,
  | 'wallet_id'
  | 'amount'
  | 'currency'
  | 'converted_amount'
  | 'converted_currency'
>;

type OwnedWallet = {
  id: number;
  user_id: number | null;
  currency: string;
};

type TransactionQuery = {
  walletId?: number;
  categoryId?: number;
  type?: TransactionType;
  cashFlow?: 'normal' | 'loan_debt';
  tag?: string;
  q?: string;
  note?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

@Injectable()
export class TransactionsService {
  private readonly receiptUploadDir = normalize(
    join(process.cwd(), 'uploads', 'receipts'),
  );

  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
    private notificationsService: NotificationsService,
  ) {}

  private readonly transactionSelect = {
    id: true,
    wallet_id: true,
    category_id: true,
    amount: true,
    currency: true,
    converted_amount: true,
    converted_currency: true,
    exchange_rate_used: true,
    note: true,
    receipt_image: true,
    transaction_date: true,
    created_at: true,
  } as const;

  private toDecimal(value: string) {
    return new Prisma.Decimal(value);
  }

  private toPositiveDecimal(value: string) {
    const decimal = this.toDecimal(value);

    if (decimal.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Số tiền giao dịch phải lớn hơn 0');
    }

    return decimal;
  }

  private parseDateFilter(value: string, endOfDay = false) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      throw new BadRequestException('Ngày lọc giao dịch không hợp lệ');
    }

    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );

    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      throw new BadRequestException('Ngày lọc giao dịch không hợp lệ');
    }

    return date;
  }

  private parseTransactionDate(value: string) {
    return this.parseDateFilter(value);
  }

  private getTypeFromSignedAmount(amount: Prisma.Decimal) {
    return amount.greaterThanOrEqualTo(0)
      ? TransactionType.INCOME
      : TransactionType.EXPENSE;
  }

  private toSignedAmount(amount: string, type: TransactionType) {
    const decimal = this.toPositiveDecimal(amount);
    return type === TransactionType.EXPENSE ? decimal.negated() : decimal;
  }

  private normalizeTags(tags?: string[]) {
    if (!tags) {
      return [];
    }

    return [
      ...new Set(
        tags
          .map((tag) => tag.trim().replace(/^#+/, '').toLowerCase())
          .filter((tag) => tag.length > 0)
          .map((tag) => tag.slice(0, 50)),
      ),
    ].slice(0, 8);
  }

  private async deleteReceiptFile(filename?: string | null) {
    if (!filename || filename.includes('/') || filename.includes('\\')) {
      return;
    }

    const targetPath = normalize(join(this.receiptUploadDir, filename));

    if (
      !targetPath.startsWith(this.receiptUploadDir) ||
      !existsSync(targetPath)
    ) {
      return;
    }

    try {
      await unlink(targetPath);
    } catch {
      // The database state is the source of truth; a missing/locked file should not fail the transaction flow.
    }
  }

  private async syncTags(
    tx: Prisma.TransactionClient,
    userId: number,
    transactionId: number,
    tags?: string[],
  ) {
    if (tags === undefined) {
      return;
    }

    const normalizedTags = this.normalizeTags(tags);

    await tx.transaction_tags.deleteMany({
      where: { transaction_id: transactionId },
    });

    if (normalizedTags.length === 0) {
      return;
    }

    for (const tagName of normalizedTags) {
      const tag =
        (await tx.tags.findFirst({
          where: {
            name: tagName,
            user_id: userId,
          },
        })) ??
        (await tx.tags.create({
          data: {
            name: tagName,
            user_id: userId,
          },
        }));

      await tx.transaction_tags.create({
        data: {
          transaction_id: transactionId,
          tag_id: tag.id,
        },
      });
    }
  }

  private async getActorCurrency(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { currency_default: true },
    });

    return this.currencyService.normalizeCurrency(user?.currency_default);
  }

  private async buildConversionSnapshot(
    amount: Prisma.Decimal,
    sourceCurrency: string,
    targetCurrency: string,
  ) {
    const fromCurrency = this.currencyService.normalizeCurrency(sourceCurrency);
    const toCurrency = this.currencyService.normalizeCurrency(targetCurrency);
    const converted = await this.currencyService.convertAmount(
      amount.abs(),
      fromCurrency,
      toCurrency,
    );

    return {
      currency: fromCurrency,
      converted_amount: new Prisma.Decimal(converted.amount.toFixed(2)),
      converted_currency: converted.toCurrency,
      exchange_rate_used: new Prisma.Decimal(String(converted.rate)),
    };
  }

  private async getDisplayConversion(
    transaction: TransactionMoneyFields,
    sourceCurrency: string,
    targetCurrency: string,
  ) {
    const normalizedTarget =
      this.currencyService.normalizeCurrency(targetCurrency);

    if (
      transaction.converted_amount !== null &&
      transaction.converted_amount !== undefined &&
      transaction.converted_currency &&
      this.currencyService.normalizeCurrency(transaction.converted_currency) ===
        normalizedTarget
    ) {
      return {
        amount: Number(transaction.converted_amount),
        toCurrency: normalizedTarget,
      };
    }

    return this.currencyService.convertAmount(
      new Prisma.Decimal(transaction.amount).abs(),
      transaction.currency ?? sourceCurrency,
      normalizedTarget,
    );
  }

  private async summarizeTransactions(
    transactionsList: TransactionMoneyFields[],
    walletCurrencyMap: Map<number, string>,
    targetCurrency: string,
  ) {
    const amounts = await Promise.all(
      transactionsList.map(async (transaction) => {
        const signedAmount = new Prisma.Decimal(transaction.amount);
        const converted = await this.getDisplayConversion(
          transaction,
          walletCurrencyMap.get(transaction.wallet_id ?? 0) ?? 'VND',
          targetCurrency,
        );

        return {
          type: this.getTypeFromSignedAmount(signedAmount),
          amount: converted.amount,
        };
      }),
    );

    return amounts.reduce(
      (summary, item) => {
        if (item.type === TransactionType.INCOME) {
          summary.income += item.amount;
        } else {
          summary.expense += item.amount;
        }

        summary.net = summary.income - summary.expense;
        return summary;
      },
      { income: 0, expense: 0, net: 0 },
    );
  }

  private async normalizeTransaction(
    transaction: TransactionWithCategory,
    walletCurrency: string,
    targetCurrency: string,
  ) {
    const signedAmount = new Prisma.Decimal(transaction.amount);
    const type = this.getTypeFromSignedAmount(signedAmount);
    const absoluteAmount = signedAmount.abs();
    const converted = await this.getDisplayConversion(
      transaction,
      walletCurrency,
      targetCurrency,
    );

    return {
      ...transaction,
      amount: absoluteAmount,
      type,
      currency: this.currencyService.normalizeCurrency(
        transaction.currency ?? walletCurrency,
      ),
      display_amount: converted.amount,
      display_currency: converted.toCurrency,
      category: transaction.category
        ? {
            id: transaction.category.id,
            name: transaction.category.name,
            type: transaction.category.type,
            cash_flow_group: transaction.category.cash_flow_group,
            icon: transaction.category.icon,
          }
        : null,
      tags: transaction.tags ?? [],
    };
  }

  private async getOwnedWallet(userId: number, walletId: number) {
    const wallets = await this.prisma.$queryRaw<OwnedWallet[]>`
      SELECT id, user_id, currency
      FROM wallets
      WHERE id = ${walletId} AND user_id = ${userId}
        AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `;
    const wallet = wallets[0];

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    return wallet satisfies OwnedWallet;
  }

  private async getOwnedWalletForRead(userId: number, walletId: number) {
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
          ? { id: categoryId, OR: [{ is_active: true }, { is_active: null }] }
          : {
              id: categoryId,
              AND: [
                { OR: [{ is_active: true }, { is_active: null }] },
                { OR: [{ is_system: true }, { user_id: userId }] },
              ],
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
    const transactionIds = transactionsList.map(
      (transaction) => transaction.id,
    );
    const tagRows =
      transactionIds.length > 0
        ? await this.prisma.$queryRaw<
            Array<{
              transaction_id: number;
              name: string;
            }>
          >`
            SELECT tt.transaction_id, t.name
            FROM transaction_tags tt
            INNER JOIN tags t ON t.id = tt.tag_id
            WHERE tt.transaction_id IN (${Prisma.join(transactionIds)})
            ORDER BY t.name ASC
          `
        : [];
    const tagMap = new Map<number, string[]>();

    tagRows.forEach((row) => {
      tagMap.set(row.transaction_id, [
        ...(tagMap.get(row.transaction_id) ?? []),
        row.name,
      ]);
    });

    return Promise.all(
      transactionsList.map((transaction) =>
        this.normalizeTransaction(
          {
            ...transaction,
            category: transaction.category_id
              ? (categoryMap.get(transaction.category_id) ?? null)
              : null,
            tags: tagMap.get(transaction.id) ?? [],
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
      throw new BadRequestException(
        'Vui lòng chọn loại giao dịch khi chưa chọn danh mục.',
      );
    }

    return fallbackType;
  }

  async findAll(userId: number, query: TransactionQuery = {}) {
    const wallets = await this.prisma.$queryRaw<
      Array<{ id: number; currency: string }>
    >`
      SELECT id, currency
      FROM wallets
      WHERE user_id = ${userId}
    `;

    const walletIds = wallets.map((wallet) => wallet.id);
    const walletCurrencyMap = new Map(
      wallets.map((wallet) => [wallet.id, wallet.currency]),
    );

    if (query.walletId !== undefined) {
      await this.getOwnedWalletForRead(userId, query.walletId);
    }

    const where: Prisma.transactionsWhereInput = {
      wallet_id: query.walletId ?? { in: walletIds },
    };

    if (query.categoryId !== undefined) {
      where.category_id = query.categoryId;
    }

    if (query.type === TransactionType.INCOME) {
      where.amount = { gte: 0 };
    }

    if (query.type === TransactionType.EXPENSE) {
      where.amount = { lt: 0 };
    }

    if (query.cashFlow === 'normal') {
      const normalCategories = await this.prisma.categories.findMany({
        where: { cash_flow_group: { not: 'LOAN_DEBT' } },
        select: { id: true },
      });
      const normalCategoryIds = normalCategories.map((category) => category.id);

      where.OR = [
        { category_id: null },
        { category_id: { in: normalCategoryIds } },
      ];
    }

    if (query.cashFlow === 'loan_debt') {
      const loanDebtCategories = await this.prisma.categories.findMany({
        where: { cash_flow_group: 'LOAN_DEBT' },
        select: { id: true },
      });

      where.AND = [
        {
          category_id: {
            in: loanDebtCategories.map((category) => category.id),
          },
        },
      ];
    }

    if (query.from || query.to) {
      where.transaction_date = {
        ...(query.from ? { gte: this.parseDateFilter(query.from) } : {}),
        ...(query.to ? { lte: this.parseDateFilter(query.to, true) } : {}),
      };
    }

    const noteKeyword = (query.note ?? query.q)?.trim();

    if (noteKeyword) {
      where.note = { contains: noteKeyword };
    }

    if (query.tag?.trim()) {
      const normalizedTag = query.tag.trim().replace(/^#+/, '').toLowerCase();
      const taggedRows = await this.prisma.$queryRaw<
        Array<{ transaction_id: number }>
      >`
        SELECT DISTINCT tt.transaction_id
        FROM transaction_tags tt
        INNER JOIN tags t ON t.id = tt.tag_id
        WHERE t.user_id = ${userId}
          AND t.name LIKE ${`%${normalizedTag}%`}
      `;
      const transactionIds = taggedRows.map((row) => row.transaction_id);

      where.id =
        transactionIds.length > 0 ? { in: transactionIds } : { in: [] };
    }

    const shouldPaginate =
      query.page !== undefined || query.limit !== undefined;
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));

    const transactionsList = await this.prisma.transactions.findMany({
      where,
      orderBy: [
        { transaction_date: 'desc' },
        { created_at: 'desc' },
        { id: 'desc' },
      ],
      select: this.transactionSelect,
      ...(shouldPaginate
        ? {
            skip: (page - 1) * limit,
            take: limit,
          }
        : {}),
    });
    const data = await this.attachCategories(
      userId,
      transactionsList,
      walletCurrencyMap,
    );

    if (!shouldPaginate) {
      return data;
    }

    const total = await this.prisma.transactions.count({ where });
    const filteredTransactions = await this.prisma.transactions.findMany({
      where,
      select: {
        wallet_id: true,
        amount: true,
        currency: true,
        converted_amount: true,
        converted_currency: true,
      },
    });
    const summary = await this.summarizeTransactions(
      filteredTransactions,
      walletCurrencyMap,
      await this.getActorCurrency(userId),
    );

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        income: summary.income,
        expense: summary.expense,
        net: summary.net,
      },
    };
  }

  async create(userId: number, dto: CreateTransactionDto) {
    const wallet = await this.getOwnedWallet(userId, dto.wallet_id);
    const type = await this.resolveType(userId, dto.category_id, dto.type);
    const signedAmount = this.toSignedAmount(dto.amount, type);
    const targetCurrency = await this.getActorCurrency(userId);
    const conversionSnapshot = await this.buildConversionSnapshot(
      signedAmount,
      wallet.currency,
      targetCurrency,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transactions.create({
        data: {
          wallet_id: dto.wallet_id,
          category_id: dto.category_id,
          amount: signedAmount,
          ...conversionSnapshot,
          note: dto.note,
          receipt_image: dto.receipt_image,
          transaction_date: dto.transaction_date
            ? this.parseTransactionDate(dto.transaction_date)
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

      await this.syncTags(tx, userId, transaction.id, dto.tags);

      return transaction;
    });

    if (type === TransactionType.EXPENSE) {
      await this.notificationsService.createBudgetAlertsForWallet(
        userId,
        dto.wallet_id,
      );
    }

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
    const shouldRefreshSnapshot =
      dto.amount !== undefined ||
      dto.wallet_id !== undefined ||
      dto.category_id !== undefined ||
      dto.type !== undefined;
    const conversionSnapshot = shouldRefreshSnapshot
      ? await this.buildConversionSnapshot(
          nextSignedAmount,
          nextWallet.currency,
          await this.getActorCurrency(userId),
        )
      : null;

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

      const transaction = await tx.transactions.update({
        where: { id },
        data: {
          wallet_id: nextWalletId,
          category_id: dto.category_id ?? undefined,
          amount: nextSignedAmount,
          currency: conversionSnapshot?.currency,
          converted_amount: conversionSnapshot?.converted_amount,
          converted_currency: conversionSnapshot?.converted_currency,
          exchange_rate_used: conversionSnapshot?.exchange_rate_used,
          note: dto.note ?? undefined,
          receipt_image: Object.prototype.hasOwnProperty.call(
            dto,
            'receipt_image',
          )
            ? (dto.receipt_image ?? null)
            : undefined,
          transaction_date: dto.transaction_date
            ? this.parseTransactionDate(dto.transaction_date)
            : undefined,
        },
        select: this.transactionSelect,
      });

      await this.syncTags(tx, userId, id, dto.tags);

      return transaction;
    });

    if (
      nextType === TransactionType.EXPENSE ||
      currentType === TransactionType.EXPENSE
    ) {
      const walletIdsToCheck = new Set<number>([nextWalletId]);

      if (
        currentType === TransactionType.EXPENSE &&
        current.wallet_id !== nextWalletId
      ) {
        walletIdsToCheck.add(current.wallet_id);
      }

      for (const walletId of walletIdsToCheck) {
        await this.notificationsService.createBudgetAlertsForWallet(
          userId,
          walletId,
        );
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(dto, 'receipt_image') &&
      dto.receipt_image === null &&
      current.receipt_image
    ) {
      await this.deleteReceiptFile(current.receipt_image);
    }

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
      await tx.transaction_tags.deleteMany({
        where: { transaction_id: id },
      });

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

    await this.deleteReceiptFile(current.receipt_image);

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

    if (current.receipt_image && current.receipt_image !== filename) {
      await this.deleteReceiptFile(current.receipt_image);
    }

    const walletCurrencyMap = new Map([[wallet.id, wallet.currency]]);
    const [normalized] = await this.attachCategories(
      userId,
      [updated],
      walletCurrencyMap,
    );

    return normalized;
  }
}
