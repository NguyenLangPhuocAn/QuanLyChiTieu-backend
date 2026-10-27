import { normalizeTagName } from '../common/normalize-tag';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  categories,
  categories_type,
  transactions,
} from '@prisma/client';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join, normalize } from 'path';
import ExcelJS from 'exceljs';
import { CurrencyService } from '../currency/currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { isSavingTransferCategory } from '../common/finance/cash-flow-classification';
import {
  CreateTransactionDto,
  TransactionType,
} from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { validatePaymentLinkIds } from './payment-link-ids';

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
  wallet_type: string;
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
  minAmount?: number;
  maxAmount?: number;
  page?: number;
  limit?: number;
};

const excelValueText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();

  const structured = value as {
    text?: unknown;
    result?: unknown;
    richText?: Array<{ text?: unknown }>;
  };
  if (typeof structured.text === 'string') return structured.text;
  if (
    typeof structured.result === 'string' ||
    typeof structured.result === 'number' ||
    typeof structured.result === 'boolean'
  ) {
    return String(structured.result);
  }
  if (Array.isArray(structured.richText)) {
    return structured.richText
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
};

const parseExcelDate = (value: ExcelJS.CellValue): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const date = new Date(Math.round((value - 25569) * 86_400_000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = excelValueText(value).trim();
  const localized = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (localized) {
    const date = new Date(
      Number(localized[3]),
      Number(localized[2]) - 1,
      Number(localized[1]),
      Number(localized[4] ?? 0),
      Number(localized[5] ?? 0),
      Number(localized[6] ?? 0),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseExcelNumber = (value: ExcelJS.CellValue): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = excelValueText(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly receiptUploadDir = normalize(
    join(process.cwd(), 'uploads', 'receipts'),
  );

  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
    private notificationsService: NotificationsService,
  ) {}

  private async notifyBudgetAfterCommit(userId: number, walletId: number) {
    try {
      await this.notificationsService.createBudgetAlertsForWallet(
        userId,
        walletId,
      );
    } catch {
      // The financial transaction is already committed. A notification failure
      // must not make the client retry it as though the save had failed.
      this.logger.warn(
        'Transaction saved, but budget notification generation failed.',
      );
    }
  }

  private async lockUnchangedTransaction(
    tx: Prisma.TransactionClient,
    expected: Pick<transactions, 'id' | 'wallet_id' | 'category_id' | 'amount'>,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: number;
        wallet_id: number | null;
        category_id: number | null;
        amount: Prisma.Decimal;
      }>
    >`
      SELECT id, wallet_id, category_id, amount FROM transactions
      WHERE id = ${expected.id} FOR UPDATE
    `;
    const latest = rows[0];
    if (!latest)
      throw new NotFoundException(
        'Giao dịch đã bị xóa. Vui lòng tải lại danh sách.',
      );
    if (
      latest.wallet_id !== expected.wallet_id ||
      latest.category_id !== expected.category_id ||
      !new Prisma.Decimal(latest.amount).equals(expected.amount)
    ) {
      throw new ConflictException(
        'Giao dịch vừa được thay đổi. Vui lòng tải lại trước khi sửa hoặc xóa.',
      );
    }
  }

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
    receipt_items: true,
    transaction_date: true,
    created_at: true,
  } as const;

  private toDecimal(value: string) {
    return new Prisma.Decimal(value);
  }

  private toPositiveDecimal(value: string) {
    const decimal = this.toDecimal(value);

    if (!decimal.isFinite() || decimal.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Số tiền giao dịch phải lớn hơn 0');
    }

    return decimal;
  }

  private buildSourceMetadata(dto: CreateTransactionDto) {
    if (dto.client_request_id && (dto.source || dto.source_ref)) {
      throw new BadRequestException(
        'Chỉ dùng một mã chống trùng cho mỗi giao dịch',
      );
    }
    if (!dto.source && !dto.source_ref && !dto.client_request_id) return null;
    if (!dto.source || !dto.source_ref) {
      if (!dto.client_request_id) {
        throw new BadRequestException(
          'Nguồn giao dịch và mã chống trùng phải được gửi cùng nhau',
        );
      }
    }

    const isBankNotification = Boolean(dto.source && dto.source_ref);
    const sourceRef = isBankNotification
      ? `bank:${dto.source_ref!.toLowerCase()}`
      : `client:${dto.client_request_id!.toLowerCase()}`;
    const sourceType = isBankNotification
      ? 'BANK_NOTIFICATION_IMPORT'
      : 'CLIENT_TRANSACTION_REQUEST';
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          wallet_id: dto.wallet_id,
          category_id: dto.category_id ?? null,
          amount: dto.amount,
          type: dto.type ?? null,
          note: dto.note?.trim() ?? '',
          transaction_date: dto.transaction_date ?? null,
          receipt_image: dto.receipt_image ?? null,
          receipt_items: dto.receipt_items ?? null,
          tags: dto.tags ?? [],
          source: dto.source ?? null,
        }),
      )
      .digest('hex');

    return { sourceRef, sourceType, payloadHash, isBankNotification };
  }

  private async findSourceDuplicate(
    userId: number,
    sourceRef: string,
    sourceType: string,
    payloadHash: string,
    isBankNotification: boolean,
  ) {
    const marker = await this.prisma.notifications.findFirst({
      where: {
        user_id: userId,
        dedupe_key: sourceRef,
        source_type: sourceType,
      },
      select: {
        message: true,
        source_id: true,
      },
    });
    if (!marker) return null;
    if (marker.message !== payloadHash) {
      throw new ConflictException(
        isBankNotification
          ? 'Thông báo ngân hàng này đã được xử lý với nội dung khác'
          : 'Yêu cầu này đã được xử lý với nội dung khác',
      );
    }
    if (!marker.source_id) {
      throw new ConflictException(
        isBankNotification
          ? 'Thông báo ngân hàng đang được xử lý'
          : 'Yêu cầu giao dịch đang được xử lý',
      );
    }

    const existing = await this.prisma.transactions.findUnique({
      where: { id: marker.source_id },
      select: this.transactionSelect,
    });
    if (!existing?.wallet_id)
      throw new ConflictException(
        isBankNotification
          ? 'Thông báo ngân hàng này đã được xử lý'
          : 'Yêu cầu giao dịch này đã được xử lý',
      );

    const wallet = await this.getOwnedWallet(userId, existing.wallet_id);
    const [normalized] = await this.attachCategories(
      userId,
      [existing],
      new Map([[wallet.id, wallet.currency]]),
    );
    return normalized;
  }

  private async adjustWalletBalance(
    tx: Prisma.TransactionClient,
    userId: number,
    wallet: { id: number; currency: string },
    delta: Prisma.Decimal,
  ) {
    const changed = await tx.wallets.updateMany({
      where: {
        id: wallet.id,
        user_id: userId,
        currency: wallet.currency,
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
      },
      data: { balance: { increment: delta } },
    });
    if (changed.count !== 1) {
      throw new ConflictException(
        'Ví vừa thay đổi hoặc không còn hoạt động. Vui lòng tải lại trước khi lưu.',
      );
    }
  }

  private async assertNotLoanManaged(transactionId: number) {
    const [opening, payment] = await Promise.all([
      this.prisma.loan_debts.findFirst({
        where: { opening_transaction_id: transactionId, deleted_at: null },
        select: { id: true },
      }),
      this.prisma.loan_debt_payments.findFirst({
        where: { transaction_id: transactionId, deleted_at: null },
        select: { id: true },
      }),
    ]);
    if (opening || payment) {
      throw new BadRequestException(
        'Giao dịch này thuộc khoản vay/nợ. Vui lòng chỉnh sửa hoặc xóa trong mục Vay và nợ để cập nhật đúng số tiền còn lại.',
      );
    }
  }

  private parseDateFilter(value: string, endOfDay = false) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      throw new BadRequestException('Ngày lọc giao dịch không hợp lệ');
    }

    // A transaction date is a calendar date, not a local timestamp. Build its
    // canonical representation at UTC midnight so the host timezone cannot
    // move YYYY-MM-DD to the previous day when Nest serializes it as JSON.
    const date = new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
      ),
    );

    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() !== Number(match[2]) - 1 ||
      date.getUTCDate() !== Number(match[3])
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
          .map(normalizeTagName)
          .filter((tag) => tag.length > 0)
          .map((tag) => tag.slice(0, 50)),
      ),
    ].slice(0, 8);
  }

  private normalizeReceiptItems(
    items: unknown[] | null | undefined,
  ): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
    if (items === undefined) return undefined;
    if (items === null) return Prisma.DbNull;
    if (items.length > 100) {
      throw new BadRequestException('Hóa đơn chỉ hỗ trợ tối đa 100 món');
    }

    return items.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException(
          `Món thứ ${index + 1} trong hóa đơn chưa hợp lệ`,
        );
      }
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const amount =
        typeof record.amount === 'number'
          ? record.amount
          : typeof record.amount === 'string' && record.amount.trim()
            ? Number(record.amount)
            : Number.NaN;

      if (!name || name.length > 200) {
        throw new BadRequestException(
          `Tên món thứ ${index + 1} phải có từ 1 đến 200 ký tự`,
        );
      }
      if (!Number.isFinite(amount) || Math.abs(amount) > 999_999_999_999.99) {
        throw new BadRequestException(`Số tiền món “${name}” chưa hợp lệ`);
      }

      return { name, amount: Math.round(amount * 100) / 100 };
    });
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
      SELECT id, user_id, currency, wallet_type
      FROM wallets
      WHERE id = ${walletId} AND user_id = ${userId}
        AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `;
    const wallet = wallets[0];

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (wallet.wallet_type === 'SAVINGS') {
      throw new BadRequestException(
        'Hãy đóng góp hoặc rút tiền trong mục tiêu tiết kiệm',
      );
    }

    return wallet satisfies OwnedWallet;
  }

  private async getOwnedWalletForRead(userId: number, walletId: number) {
    const wallets = await this.prisma.$queryRaw<OwnedWallet[]>`
      SELECT id, user_id, currency, wallet_type
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
      if (isSavingTransferCategory(category)) {
        throw new BadRequestException(
          'Danh mục Tiết kiệm đã được thay bằng chức năng Mục tiêu tiết kiệm',
        );
      }
      return category.type as TransactionType;
    }

    if (!fallbackType) {
      throw new BadRequestException(
        'Vui lòng chọn loại giao dịch khi chưa chọn danh mục.',
      );
    }

    return fallbackType;
  }

  async linkedPayments(userId: number, ids: number[]) {
    validatePaymentLinkIds(ids);
    // One bounded, owner-scoped query. Do not filter by amount/date/category:
    // a changed transaction must be returned so the client can disclose it.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        wallet_id: number;
        amount: Prisma.Decimal;
        currency: string;
        transaction_date: Date;
        note: string | null;
        category_id: number | null;
        category_name: string | null;
        category_type: categories_type | null;
        cash_flow_group: categories['cash_flow_group'] | null;
      }>
    >`
      SELECT t.id, t.wallet_id, t.amount,
        COALESCE(t.currency, w.currency) AS currency,
        t.transaction_date, t.note, c.id AS category_id,
        c.name AS category_name, c.type AS category_type, c.cash_flow_group
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE w.user_id = ${userId} AND t.id IN (${Prisma.join(ids)})
      ORDER BY t.id
    `;
    const found = new Set(rows.map((row) => row.id));
    return {
      requestedIds: ids,
      missingIds: ids.filter((id) => !found.has(id)),
      data: rows.map((row) => ({
        id: row.id,
        wallet_id: row.wallet_id,
        amount: row.amount.toString(),
        currency: row.currency,
        transaction_date: row.transaction_date.toISOString(),
        note: row.note,
        type: this.getTypeFromSignedAmount(row.amount),
        category: row.category_id
          ? {
              id: row.category_id,
              name: row.category_name,
              type: row.category_type,
              cash_flow_group: row.cash_flow_group,
            }
          : null,
      })),
    };
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

    if (query.minAmount !== undefined || query.maxAmount !== undefined) {
      if (
        query.minAmount !== undefined &&
        query.maxAmount !== undefined &&
        query.minAmount > query.maxAmount
      ) {
        throw new BadRequestException(
          'Số tiền tối thiểu không được lớn hơn số tiền tối đa.',
        );
      }
      if (query.type === TransactionType.INCOME) {
        where.amount = {
          gte: query.minAmount ?? 0,
          ...(query.maxAmount !== undefined ? { lte: query.maxAmount } : {}),
        };
      } else if (query.type === TransactionType.EXPENSE) {
        where.amount = {
          ...(query.maxAmount !== undefined ? { gte: -query.maxAmount } : {}),
          ...(query.minAmount !== undefined
            ? { lte: -query.minAmount }
            : { lt: 0 }),
        };
      } else {
        const existingAnd = where.AND
          ? Array.isArray(where.AND)
            ? where.AND
            : [where.AND]
          : [];
        where.AND = [
          ...existingAnd,
          {
            OR: [
              {
                amount: {
                  gte: query.minAmount ?? 0,
                  ...(query.maxAmount !== undefined
                    ? { lte: query.maxAmount }
                    : {}),
                },
              },
              {
                amount: {
                  ...(query.maxAmount !== undefined
                    ? { gte: -query.maxAmount }
                    : {}),
                  ...(query.minAmount !== undefined
                    ? { lte: -query.minAmount }
                    : { lt: 0 }),
                },
              },
            ],
          },
        ];
      }
    }

    if (query.cashFlow === 'normal') {
      const normalCategories = await this.prisma.categories.findMany({
        where: { cash_flow_group: 'NORMAL' },
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

      const existingAnd = where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : [];
      where.AND = [
        ...existingAnd,
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

    const noteKeywords = [
      ...new Set(
        [query.q, query.note]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (noteKeywords.length) {
      const existingAnd = where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : [];
      where.AND = [
        ...existingAnd,
        ...noteKeywords.map((keyword) => ({ note: { contains: keyword } })),
      ];
    }

    if (query.tag?.trim()) {
      const normalizedTag = normalizeTagName(query.tag);
      const taggedRows = await this.prisma.$queryRaw<
        Array<{ transaction_id: number }>
      >`
        SELECT DISTINCT tt.transaction_id
        FROM transaction_tags tt
        INNER JOIN tags t ON t.id = tt.tag_id
        WHERE t.user_id = ${userId}
          AND LOCATE(${normalizedTag}, t.name) > 0
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

  async importExcel(
    userId: number,
    file: Buffer,
    previewOnly = false,
    selectedRows?: ReadonlySet<number>,
  ) {
    const fileHash = createHash('sha256').update(file).digest('hex');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as never);
    const sheet = workbook.getWorksheet('Giao dịch');

    if (!sheet || sheet.actualRowCount < 2) {
      throw new BadRequestException(
        'File Excel không có sheet “Giao dịch” hoặc chưa có dữ liệu.',
      );
    }

    const headerColumns = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => {
      headerColumns.set(cell.text.trim(), column);
    });
    const requiredHeaders = ['Ngày', 'Loại', 'Ví', 'Số tiền gốc'];
    if (requiredHeaders.some((header) => !headerColumns.has(header))) {
      throw new BadRequestException(
        'File Excel chưa đúng mẫu xuất từ ứng dụng.',
      );
    }

    const wallets = await this.prisma.wallets.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
        wallet_type: { not: 'SAVINGS' },
      },
      select: { id: true, name: true, currency: true },
    });
    if (!wallets.length) {
      throw new BadRequestException('Hãy tạo ít nhất một ví trước khi nhập.');
    }
    const categories = await this.prisma.categories.findMany({
      where: {
        deleted_at: null,
        OR: [{ is_system: true }, { user_id: userId }],
        cash_flow_group: 'NORMAL',
      },
      select: { id: true, name: true, type: true },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const existing = await this.prisma.transactions.findMany({
      where: { wallet_id: { in: walletIds } },
      select: {
        wallet_id: true,
        category_id: true,
        amount: true,
        note: true,
        transaction_date: true,
      },
    });
    const duplicateKey = (value: {
      walletId: number;
      categoryId?: number | null;
      amount: number;
      note?: string | null;
      date: Date;
    }) =>
      [
        value.walletId,
        value.categoryId ?? '',
        Math.abs(value.amount).toFixed(2),
        value.note?.trim() ?? '',
        value.date.toISOString().slice(0, 19),
      ].join('|');
    const existingKeys = new Set(
      existing.map((transaction) =>
        duplicateKey({
          walletId: transaction.wallet_id ?? 0,
          categoryId: transaction.category_id,
          amount: Number(transaction.amount),
          note: transaction.note,
          date: transaction.transaction_date,
        }),
      ),
    );

    const receiptItemsByTransaction = new Map<
      string,
      Array<{ name: string; amount: number }>
    >();
    const detailSheet = workbook.getWorksheet('Chi tiết hóa đơn');
    if (detailSheet && detailSheet.actualRowCount > 1) {
      const detailHeaders = new Map<string, number>();
      detailSheet.getRow(1).eachCell((cell, column) => {
        detailHeaders.set(cell.text.trim(), column);
      });
      const idColumn = detailHeaders.get('Mã giao dịch');
      const nameColumn = detailHeaders.get('Tên món/nội dung');
      const amountColumn = detailHeaders.get('Thành tiền');
      if (idColumn && nameColumn && amountColumn) {
        detailSheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const oldId = row.getCell(idColumn).text.trim();
          const name = row.getCell(nameColumn).text.trim();
          const amount = parseExcelNumber(row.getCell(amountColumn).value);
          if (!oldId || !name || amount === null || amount < 0) return;
          receiptItemsByTransaction.set(oldId, [
            ...(receiptItemsByTransaction.get(oldId) ?? []),
            { name, amount },
          ]);
        });
      }
    }

    const cell = (row: ExcelJS.Row, header: string) => {
      const column = headerColumns.get(header);
      return column ? row.getCell(column) : null;
    };
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const warnings: string[] = [];
    const previewRows: Array<{
      row: number;
      status: 'READY' | 'DUPLICATE' | 'INVALID' | 'UNSUPPORTED';
      date?: string;
      type?: TransactionType;
      wallet?: string;
      category?: string | null;
      amount?: number;
      note?: string;
      reason?: string;
    }> = [];
    const createdIds: number[] = [];

    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const group = cell(row, 'Nhóm giao dịch')?.text.trim();
      if (group && group !== 'Thu/chi thông thường') {
        skipped += 1;
        previewRows.push({
          row: rowNumber,
          status: 'UNSUPPORTED',
          reason: `Nhóm “${group}” được giữ ngoài luồng nhập thu/chi.`,
        });
        continue;
      }
      const date = parseExcelDate(cell(row, 'Ngày')?.value ?? null);
      const amount = parseExcelNumber(cell(row, 'Số tiền gốc')?.value ?? null);
      const typeText = cell(row, 'Loại')?.text.trim().toLocaleLowerCase('vi');
      const type =
        typeText === 'thu' ? TransactionType.INCOME : TransactionType.EXPENSE;
      const categoryType =
        type === TransactionType.INCOME
          ? categories_type.INCOME
          : categories_type.EXPENSE;
      const walletName = cell(row, 'Ví')?.text.trim().toLocaleLowerCase('vi');
      const walletCurrency = cell(row, 'Tiền tệ gốc')
        ?.text.trim()
        .toUpperCase();
      const oldWalletId = parseExcelNumber(cell(row, 'Mã ví')?.value ?? null);
      const wallet =
        wallets.find((item) => item.id === oldWalletId) ??
        wallets.find(
          (item) =>
            item.name.trim().toLocaleLowerCase('vi') === walletName &&
            (!walletCurrency || item.currency.toUpperCase() === walletCurrency),
        );
      if (!date || amount === null || amount <= 0 || !wallet) {
        failed += 1;
        const reason = 'Thiếu ngày, số tiền hoặc ví phù hợp.';
        warnings.push(`Dòng ${rowNumber}: ${reason}`);
        previewRows.push({
          row: rowNumber,
          status: 'INVALID',
          amount: amount ?? undefined,
          reason,
        });
        continue;
      }

      const categoryName = cell(row, 'Danh mục')
        ?.text.trim()
        .toLocaleLowerCase('vi');
      const oldCategoryId = parseExcelNumber(
        cell(row, 'Mã danh mục')?.value ?? null,
      );
      const category =
        categories.find(
          (item) => item.id === oldCategoryId && item.type === categoryType,
        ) ??
        categories.find(
          (item) =>
            item.type === categoryType &&
            item.name.trim().toLocaleLowerCase('vi') === categoryName,
        );
      const note = cell(row, 'Ghi chú')?.text.trim() ?? '';
      const key = duplicateKey({
        walletId: wallet.id,
        categoryId: category?.id,
        amount,
        note,
        date,
      });
      if (existingKeys.has(key)) {
        skipped += 1;
        previewRows.push({
          row: rowNumber,
          status: 'DUPLICATE',
          date: date.toISOString(),
          type,
          wallet: wallet.name,
          category: category?.name ?? null,
          amount,
          note,
          reason: 'Khớp ví, danh mục, số tiền, ghi chú và thời gian đã có.',
        });
        continue;
      }

      const tags = (cell(row, 'Hashtag')?.text ?? '')
        .split(/[#;,\n\r]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8);
      const oldTransactionId = cell(row, 'Mã giao dịch')?.text.trim() ?? '';
      if (previewOnly) {
        existingKeys.add(key);
        previewRows.push({
          row: rowNumber,
          status: 'READY',
          date: date.toISOString(),
          type,
          wallet: wallet.name,
          category: category?.name ?? null,
          amount,
          note,
        });
        continue;
      }
      if (selectedRows && !selectedRows.has(rowNumber)) {
        skipped += 1;
        continue;
      }
      try {
        const createdTransaction = await this.create(userId, {
          wallet_id: wallet.id,
          category_id: category?.id,
          type,
          amount: Math.abs(amount).toFixed(2),
          note: note || undefined,
          transaction_date: date.toISOString(),
          tags,
          receipt_items: receiptItemsByTransaction.get(oldTransactionId) ?? [],
          client_request_id: `excel_${fileHash.slice(0, 40)}_${rowNumber}`,
        });
        if (Number.isInteger(createdTransaction.id)) {
          createdIds.push(createdTransaction.id);
        }
        existingKeys.add(key);
        created += 1;
      } catch (error) {
        failed += 1;
        const reason =
          error instanceof Error ? error.message : 'Lỗi không xác định';
        warnings.push(`Dòng ${rowNumber}: ${reason}`);
      }
    }

    if (previewOnly) {
      return {
        fileHash,
        totalRows: Math.max(0, sheet.actualRowCount - 1),
        ready: previewRows.filter((row) => row.status === 'READY').length,
        duplicates: previewRows.filter((row) => row.status === 'DUPLICATE')
          .length,
        invalid: previewRows.filter((row) => row.status === 'INVALID').length,
        unsupported: previewRows.filter((row) => row.status === 'UNSUPPORTED')
          .length,
        rows: previewRows.slice(0, 500),
        warnings: warnings.slice(0, 20),
      };
    }

    let batchId: number | null = null;
    if (createdIds.length) {
      const marker = await this.prisma.notifications.create({
        data: {
          user_id: userId,
          type: 'SYSTEM',
          severity: 'INFO',
          title: 'Lô nhập Excel',
          message: JSON.stringify({
            version: 1,
            fileHash,
            transactionIds: createdIds,
            createdAt: new Date().toISOString(),
          }),
          source_type: 'EXCEL_IMPORT_BATCH',
          dedupe_key: `excel-import:${randomUUID()}`,
          read_at: new Date(),
          deleted_at: new Date(),
        },
        select: { id: true },
      });
      batchId = marker.id;
    }

    return {
      batchId,
      created,
      skipped,
      failed,
      warnings: warnings.slice(0, 20),
    };
  }

  previewExcel(userId: number, file: Buffer) {
    return this.importExcel(userId, file, true);
  }

  async undoExcelImport(userId: number, batchId: number) {
    const marker = await this.prisma.notifications.findFirst({
      where: {
        id: batchId,
        user_id: userId,
        source_type: 'EXCEL_IMPORT_BATCH',
      },
      select: { id: true, message: true },
    });
    if (!marker) {
      throw new NotFoundException('Không tìm thấy lô nhập có thể hoàn tác');
    }

    let transactionIds: number[] = [];
    try {
      const parsed = JSON.parse(marker.message) as {
        transactionIds?: unknown;
      };
      if (Array.isArray(parsed.transactionIds)) {
        transactionIds = parsed.transactionIds.filter(
          (id): id is number => Number.isInteger(id) && id > 0,
        );
      }
    } catch {
      throw new ConflictException('Thông tin lô nhập không còn hợp lệ');
    }

    let removed = 0;
    const warnings: string[] = [];
    for (const transactionId of [...transactionIds].reverse()) {
      try {
        await this.remove(userId, transactionId);
        removed += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Không thể xóa';
        warnings.push(`Giao dịch ${transactionId}: ${reason}`);
      }
    }

    await this.prisma.notifications.update({
      where: { id: marker.id },
      data: {
        source_type: 'EXCEL_IMPORT_BATCH_UNDONE',
        title: 'Đã hoàn tác lô nhập Excel',
        message: JSON.stringify({
          version: 1,
          transactionIds,
          removed,
          undoneAt: new Date().toISOString(),
        }),
      },
    });

    return {
      batchId,
      removed,
      failed: transactionIds.length - removed,
      warnings: warnings.slice(0, 20),
    };
  }

  async create(userId: number, dto: CreateTransactionDto) {
    const sourceMetadata = this.buildSourceMetadata(dto);
    if (sourceMetadata) {
      const duplicate = await this.findSourceDuplicate(
        userId,
        sourceMetadata.sourceRef,
        sourceMetadata.sourceType,
        sourceMetadata.payloadHash,
        sourceMetadata.isBankNotification,
      );
      if (duplicate) return duplicate;
    }
    const wallet = await this.getOwnedWallet(userId, dto.wallet_id);
    const type = await this.resolveType(userId, dto.category_id, dto.type);
    const signedAmount = this.toSignedAmount(dto.amount, type);
    const targetCurrency = await this.getActorCurrency(userId);
    const conversionSnapshot = await this.buildConversionSnapshot(
      signedAmount,
      wallet.currency,
      targetCurrency,
    );
    const receiptItems = this.normalizeReceiptItems(dto.receipt_items);

    let created: transactions;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const sourceMarker = sourceMetadata
          ? await tx.notifications.create({
              data: {
                user_id: userId,
                type: 'SYSTEM',
                severity: 'INFO',
                title: sourceMetadata.isBankNotification
                  ? 'Đồng bộ giao dịch ngân hàng'
                  : 'Chống ghi trùng giao dịch',
                message: sourceMetadata.payloadHash,
                source_type: sourceMetadata.sourceType,
                dedupe_key: sourceMetadata.sourceRef,
                read_at: new Date(),
                deleted_at: new Date(),
              },
              select: { id: true },
            })
          : null;
        const transaction = await tx.transactions.create({
          data: {
            wallet_id: dto.wallet_id,
            category_id: dto.category_id,
            amount: signedAmount,
            ...conversionSnapshot,
            note: dto.note,
            receipt_image: dto.receipt_image,
            receipt_items: receiptItems,
            transaction_date: dto.transaction_date
              ? this.parseTransactionDate(dto.transaction_date)
              : new Date(),
          },
          select: this.transactionSelect,
        });

        await this.adjustWalletBalance(tx, userId, wallet, signedAmount);
        await this.syncTags(tx, userId, transaction.id, dto.tags);
        if (sourceMarker) {
          await tx.notifications.update({
            where: { id: sourceMarker.id },
            data: { source_id: transaction.id },
          });
        }
        return transaction;
      });
    } catch (error) {
      if (
        sourceMetadata &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.findSourceDuplicate(
          userId,
          sourceMetadata.sourceRef,
          sourceMetadata.sourceType,
          sourceMetadata.payloadHash,
          sourceMetadata.isBankNotification,
        );
        if (duplicate) return duplicate;
      }
      throw error;
    }

    if (type === TransactionType.EXPENSE) {
      await this.notifyBudgetAfterCommit(userId, dto.wallet_id);
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
    await this.assertNotLoanManaged(id);
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
    const receiptItems = this.normalizeReceiptItems(dto.receipt_items);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockUnchangedTransaction(tx, current);
      if (current.wallet_id === nextWalletId) {
        await this.adjustWalletBalance(
          tx,
          userId,
          currentWallet,
          nextSignedAmount.minus(currentSignedAmount),
        );
      } else {
        await this.adjustWalletBalance(
          tx,
          userId,
          currentWallet,
          currentSignedAmount.negated(),
        );
        await this.adjustWalletBalance(
          tx,
          userId,
          nextWallet,
          nextSignedAmount,
        );
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
          receipt_image:
            dto.receipt_image !== undefined
              ? (dto.receipt_image ?? null)
              : undefined,
          receipt_items: receiptItems,
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
        await this.notifyBudgetAfterCommit(userId, walletId);
      }
    }

    if (dto.receipt_image === null && current.receipt_image) {
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

    await this.assertNotLoanManaged(id);
    const deleted = await this.prisma.$transaction(async (tx) => {
      await this.lockUnchangedTransaction(tx, current);
      await tx.transaction_tags.deleteMany({
        where: { transaction_id: id },
      });

      await this.adjustWalletBalance(
        tx,
        userId,
        wallet,
        new Prisma.Decimal(current.amount).negated(),
      );

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
