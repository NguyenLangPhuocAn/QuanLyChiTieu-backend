import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import nodemailerModule from 'nodemailer';

const nodemailer = nodemailerModule as unknown as {
  createTransport(options: {
    host: string;
    port: number;
    secure: boolean;
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
    auth?: { user: string; pass: string };
  }): {
    sendMail(options: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
      attachments: Array<{
        filename: string;
        content?: Buffer;
        path?: string;
        contentType?: string;
        cid?: string;
      }>;
    }): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  };
};
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  getCashFlowType,
  isNormalCashFlow,
} from '../common/finance/cash-flow-classification';
import {
  buildEmailInlineAttachments,
  buildReportEmailHtml,
} from '../common/mail/html-email';
import type { StatisticsPeriod } from './statistics.service';
import { analyzeReportRows } from './report-analysis';

type ReportFormat = 'excel' | 'pdf';
export type ReportPeriod = StatisticsPeriod | 'quarter' | 'custom';
type ReportDateRange = {
  dateFrom?: string;
  dateTo?: string;
  walletId?: number;
};

const periodLabels: Record<ReportPeriod, string> = {
  all: 'tất cả',
  day: 'ngày',
  week: 'tuần',
  month: 'tháng',
  quarter: 'quý',
  year: 'năm',
  custom: 'khoảng tùy chọn',
};

type ReportTransaction = {
  id: number;
  wallet_id: number | null;
  category_id: number | null;
  amount: Prisma.Decimal;
  currency?: string | null;
  converted_amount?: Prisma.Decimal | null;
  converted_currency?: string | null;
  exchange_rate_used?: Prisma.Decimal | null;
  note: string | null;
  receipt_image?: string | null;
  receipt_items?: Prisma.JsonValue | null;
  transaction_date: Date;
  created_at?: Date | null;
};

type ReceiptItem = {
  name: string;
  amount: number;
};

type ReportRow = {
  id: number;
  date: Date;
  wallet: string;
  walletType: string;
  category: string;
  type: string;
  amount: number;
  currency: string;
  originalAmount: number;
  originalCurrency: string;
  exchangeRateUsed: number | null;
  note: string;
  tags: string[];
  hasReceiptImage: boolean;
  receiptItems: ReceiptItem[];
  receiptItemTotal: number;
  receiptDifference: number;
  receiptStatus: string;
  cashFlowGroup: string;
  walletId: number | null;
  categoryId: number | null;
  createdAt: Date | null;
  receiptImage: string;
};

type ReportCategoryMeta = {
  id: number;
  name: string;
  type: string;
  icon?: string | null;
  cash_flow_group?: string | null;
};

const formatDate = (date: Date) =>
  `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}/${date.getFullYear()}`;

const formatFileDate = (date: Date) =>
  `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date
    .getDate()
    .toString()
    .padStart(2, '0')}`;

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const REPORT_METHODOLOGY =
  'Chỉ tính thu/chi thông thường; loại trừ chuyển nội bộ, gửi/rút tiết kiệm và vay/nợ. Chênh lệch thu – chi không phải số dư ví. Các khoản được quy đổi về tiền tệ báo cáo; ưu tiên giá trị quy đổi đã lưu, nếu chưa có dùng tỷ giá tại lúc tạo báo cáo.';

const safeSpreadsheetText = (value: string | null | undefined) => {
  const text = value ?? '';
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
};

@Injectable()
export class ReportsService {
  private readonly sendingUsers = new Set<number>();
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private normalizeReceiptItems(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item): ReceiptItem[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, Prisma.JsonValue>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const amount =
        typeof record.amount === 'number'
          ? record.amount
          : typeof record.amount === 'string'
            ? Number(record.amount)
            : Number.NaN;
      if (!name || !Number.isFinite(amount) || amount < 0) return [];
      return [{ name, amount }];
    });
  }

  private parseInputDate(value?: string) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private getPeriodRange(
    period: ReportPeriod,
    requestedRange: ReportDateRange = {},
  ) {
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );

    if (requestedRange.dateFrom || requestedRange.dateTo) {
      const requestedStart = requestedRange.dateFrom
        ? this.parseInputDate(requestedRange.dateFrom)
        : new Date(1970, 0, 1);
      const requestedEnd = requestedRange.dateTo
        ? this.parseInputDate(requestedRange.dateTo)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (!requestedStart || !requestedEnd) {
        throw new BadRequestException('Khoảng thời gian báo cáo không hợp lệ');
      }

      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const safeEnd = requestedEnd > today ? today : requestedEnd;
      if (requestedStart > safeEnd) {
        throw new BadRequestException('Ngày bắt đầu phải trước ngày kết thúc');
      }

      const end = new Date(safeEnd);
      end.setDate(end.getDate() + 1);
      return { start: requestedStart, end: end > tomorrow ? tomorrow : end };
    }

    if (period === 'quarter' || period === 'custom') {
      throw new BadRequestException(
        'Vui lòng cung cấp khoảng thời gian cho báo cáo',
      );
    }

    if (period === 'all') {
      return { start: new Date(1970, 0, 1), end: tomorrow };
    }

    if (period === 'day') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end: end > tomorrow ? tomorrow : end };
    }

    if (period === 'week') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = start.getDay();
      start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end: end > tomorrow ? tomorrow : end };
    }

    if (period === 'year') {
      const end = new Date(now.getFullYear() + 1, 0, 1);
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: end > tomorrow ? tomorrow : end,
      };
    }

    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: end > tomorrow ? tomorrow : end,
    };
  }

  private async convertTransactionAmount(
    transaction: ReportTransaction,
    walletCurrency: string,
    targetCurrency: string,
  ) {
    const target = this.currencyService.normalizeCurrency(targetCurrency);

    if (
      transaction.converted_amount &&
      transaction.converted_currency &&
      this.currencyService.normalizeCurrency(transaction.converted_currency) ===
        target
    ) {
      return Number(transaction.converted_amount);
    }

    const converted = await this.currencyService.convertAmount(
      new Prisma.Decimal(transaction.amount).abs(),
      transaction.currency ?? walletCurrency,
      target,
    );

    return converted.amount;
  }

  private async buildReportData(
    userId: number,
    role: string | null,
    period: ReportPeriod,
    requestedRange: ReportDateRange = {},
    includeAll = false,
  ) {
    if (role !== 'PREMIUM' && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Tính năng xuất báo cáo chỉ dành cho Premium',
      );
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { email: true, full_name: true, currency_default: true },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const displayCurrency = this.currencyService.normalizeCurrency(
      user.currency_default,
    );
    const range = this.getPeriodRange(period, requestedRange);
    if (
      requestedRange.walletId !== undefined &&
      (!Number.isSafeInteger(requestedRange.walletId) ||
        requestedRange.walletId <= 0)
    ) {
      throw new BadRequestException('Ví báo cáo không hợp lệ');
    }
    const wallets = await this.prisma.wallets.findMany({
      where: {
        user_id: userId,
        ...(requestedRange.walletId === undefined
          ? {}
          : { id: requestedRange.walletId }),
      },
      select: {
        id: true,
        name: true,
        wallet_type: true,
        currency: true,
        balance: true,
      },
      orderBy: { id: 'asc' },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    if (requestedRange.walletId !== undefined && !walletIds.length) {
      throw new NotFoundException('Không tìm thấy ví báo cáo');
    }
    const walletMap = new Map(wallets.map((wallet) => [wallet.id, wallet]));
    const transactions: ReportTransaction[] = walletIds.length
      ? await this.prisma.transactions.findMany({
          where: {
            wallet_id: { in: walletIds },
            transaction_date: { gte: range.start, lt: range.end },
          },
          select: {
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
          },
          orderBy: { transaction_date: 'asc' },
        })
      : [];
    const categoryIds = transactions
      .map((transaction) => transaction.category_id)
      .filter((id): id is number => id !== null);
    const categories = categoryIds.length
      ? await this.prisma.categories.findMany({
          where: { id: { in: categoryIds } },
          select: {
            id: true,
            name: true,
            type: true,
            icon: true,
            cash_flow_group: true,
          },
        })
      : [];
    const categoryMap = new Map(
      categories.map((category) => [
        category.id,
        category as ReportCategoryMeta,
      ]),
    );
    const reportTransactions = transactions.filter((transaction) => {
      const category = transaction.category_id
        ? categoryMap.get(transaction.category_id)
        : null;

      return includeAll || isNormalCashFlow(category);
    });
    const tagRows = reportTransactions.length
      ? await this.prisma.$queryRaw<
          Array<{ transaction_id: number; name: string }>
        >`
          SELECT tt.transaction_id, t.name
          FROM transaction_tags tt
          INNER JOIN tags t ON t.id = tt.tag_id
          WHERE tt.transaction_id IN (${Prisma.join(reportTransactions.map((item) => item.id))})
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

    let income = 0;
    let expense = 0;
    const rows: ReportRow[] = [];

    for (const transaction of reportTransactions) {
      const wallet = transaction.wallet_id
        ? walletMap.get(transaction.wallet_id)
        : null;
      const category = transaction.category_id
        ? categoryMap.get(transaction.category_id)
        : null;
      const signedAmount = new Prisma.Decimal(transaction.amount);
      const amount = await this.convertTransactionAmount(
        transaction,
        wallet?.currency ?? 'VND',
        displayCurrency,
      );
      const originalAmount = Number(signedAmount.abs());
      const originalCurrency = this.currencyService.normalizeCurrency(
        transaction.currency ?? wallet?.currency ?? 'VND',
      );
      const receiptItems = this.normalizeReceiptItems(
        transaction.receipt_items,
      );
      const receiptItemTotal = receiptItems.reduce(
        (sum, item) => sum + item.amount,
        0,
      );
      const receiptDifference = receiptItemTotal - originalAmount;
      const hasReceiptImage = Boolean(transaction.receipt_image);
      const receiptStatus = receiptItems.length
        ? Math.abs(receiptDifference) <= Math.max(1, originalAmount * 0.001)
          ? 'Chi tiết khớp tổng giao dịch'
          : 'Cần kiểm tra chênh lệch'
        : hasReceiptImage
          ? 'Có ảnh, chưa có chi tiết món'
          : 'Không có hóa đơn';

      if (isNormalCashFlow(category)) {
        if (signedAmount.greaterThanOrEqualTo(0)) {
          income += amount;
        } else {
          expense += amount;
        }
      }

      rows.push({
        id: transaction.id,
        date: transaction.transaction_date,
        wallet: wallet?.name ?? 'Không rõ ví',
        walletType: wallet?.wallet_type ?? '',
        category: category?.name ?? 'Không rõ danh mục',
        type: signedAmount.greaterThanOrEqualTo(0) ? 'Thu' : 'Chi',
        amount,
        currency: displayCurrency,
        originalAmount,
        originalCurrency,
        exchangeRateUsed: transaction.exchange_rate_used
          ? Number(transaction.exchange_rate_used)
          : null,
        note: transaction.note ?? '',
        tags: tagMap.get(transaction.id) ?? [],
        hasReceiptImage,
        receiptItems,
        receiptItemTotal,
        receiptDifference,
        receiptStatus,
        cashFlowGroup: getCashFlowType(category),
        walletId: transaction.wallet_id,
        categoryId: transaction.category_id,
        createdAt: transaction.created_at ?? null,
        receiptImage: transaction.receipt_image ?? '',
      });
    }

    return {
      user,
      period,
      range,
      displayCurrency,
      summary: {
        income,
        expense,
        net: income - expense,
        transactionCount: reportTransactions.length,
        receiptCount: rows.filter(
          (row) => row.hasReceiptImage || row.receiptItems.length,
        ).length,
        receiptItemCount: rows.reduce(
          (sum, row) => sum + row.receiptItems.length,
          0,
        ),
      },
      wallets,
      rows,
      periodLabel: periodLabels[period],
    };
  }

  async previewReport(
    userId: number,
    role: string | null,
    period: ReportPeriod,
    requestedRange: ReportDateRange = {},
  ) {
    const data = await this.buildReportData(
      userId,
      role,
      period,
      requestedRange,
      true,
    );
    const analysis = analyzeReportRows(
      data.rows.filter((row) => row.cashFlowGroup === 'normal'),
    );

    return {
      period: data.period,
      periodLabel: data.periodLabel,
      range: {
        dateFrom: formatDate(data.range.start),
        dateTo: formatDate(new Date(data.range.end.getTime() - 1)),
      },
      displayCurrency: data.displayCurrency,
      walletScope:
        data.wallets.length === 1
          ? data.wallets[0].name
          : `Tất cả ví (${data.wallets.length})`,
      summary: data.summary,
      topExpenseCategories: analysis.categories.slice(0, 5),
      sections: [
        'Tổng quan',
        'Giao dịch',
        'Hóa đơn',
        'Chi tiết hóa đơn',
        'Danh mục',
        'Thu chi theo kỳ',
        'Ví',
        'Chuyển ví',
        'Tiết kiệm',
        'Vay nợ',
        'Thanh toán vay nợ',
      ],
      methodology:
        'Xuất đầy đủ các loại giao dịch trong khoảng thời gian và ví đã chọn. Tổng thu/chi chỉ tính các khoản thông thường.',
    };
  }

  async exportReport(
    userId: number,
    role: string | null,
    period: ReportPeriod,
    format: ReportFormat,
    requestedRange: ReportDateRange = {},
  ) {
    const data = await this.buildReportData(
      userId,
      role,
      period,
      requestedRange,
      format === 'excel',
    );

    if (format === 'excel') {
      return this.exportExcel(
        data,
        await this.buildAdditionalExcelData(userId, data),
      );
    }

    return this.exportPdf(data);
  }

  async sendExcelReport(
    userId: number,
    role: string | null,
    period: ReportPeriod,
    email: string,
    requestedRange: ReportDateRange = {},
  ) {
    if (this.sendingUsers.has(userId)) {
      throw new ConflictException(
        'Một báo cáo đang được gửi. Vui lòng chờ kết quả trước khi gửi tiếp.',
      );
    }
    this.sendingUsers.add(userId);
    try {
      return await this.deliverExcelReport(
        userId,
        role,
        period,
        email,
        requestedRange,
      );
    } finally {
      this.sendingUsers.delete(userId);
    }
  }

  private async deliverExcelReport(
    userId: number,
    role: string | null,
    period: ReportPeriod,
    email: string,
    requestedRange: ReportDateRange = {},
  ) {
    const recipient =
      typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      !isEmail(recipient)
    ) {
      throw new BadRequestException('Email nhận báo cáo chưa hợp lệ');
    }

    const data = await this.buildReportData(
      userId,
      role,
      period,
      requestedRange,
      true,
    );
    const report = await this.exportExcel(
      data,
      await this.buildAdditionalExcelData(userId, data),
    );
    const rangeLabel = `${formatDate(data.range.start)} - ${formatDate(new Date(data.range.end.getTime() - 1))}`;
    const analysis = analyzeReportRows(
      data.rows.filter(
        (row) => !row.cashFlowGroup || row.cashFlowGroup === 'normal',
      ),
    );
    const money = (amount: number) =>
      `${amount.toLocaleString('vi-VN', { maximumFractionDigits: data.displayCurrency === 'VND' ? 0 : 2 })} ${data.displayCurrency}`;
    const topCategories = analysis.categories
      .slice(0, 5)
      .map(
        (row) =>
          `${row.category}: ${money(row.amount)} (${row.percent.toFixed(1)}%), ${row.count} giao dịch`,
      );
    const methodology =
      'File Excel gồm tất cả loại giao dịch trong phạm vi đã chọn. Tổng thu/chi chỉ tính các khoản thông thường.';
    const html = buildReportEmailHtml({
      recipientName: data.user.full_name || data.user.email,
      periodLabel: periodLabels[period],
      rangeLabel,
      income: `${data.summary.income.toLocaleString('vi-VN')} ${data.displayCurrency}`,
      expense: `${data.summary.expense.toLocaleString('vi-VN')} ${data.displayCurrency}`,
      net: `${data.summary.net.toLocaleString('vi-VN')} ${data.displayCurrency}`,
      transactionCount: data.summary.transactionCount,
      topCategories,
      methodology,
    });
    const mail = await this.sendMail(
      recipient,
      `Báo cáo chi tiêu ${periodLabels[period]}`,
      [
        `Xin chào ${data.user.full_name || data.user.email},`,
        '',
        'Báo cáo chi tiêu Excel của bạn đã được đính kèm trong email này.',
        `Kỳ báo cáo: ${formatDate(data.range.start)} - ${formatDate(new Date(data.range.end.getTime() - 1))}`,
        `Tổng thu: ${data.summary.income.toLocaleString('vi-VN')} ${data.displayCurrency}`,
        `Tổng chi: ${data.summary.expense.toLocaleString('vi-VN')} ${data.displayCurrency}`,
        `Chênh lệch thu – chi: ${money(data.summary.net)}`,
        `Số giao dịch: ${data.summary.transactionCount}`,
        '',
        'Danh mục chi nhiều nhất:',
        ...(topCategories.length
          ? topCategories
          : ['Không có khoản chi trong khoảng đã chọn.']),
        '',
        `Hóa đơn: ${data.summary.receiptCount}; dòng chi tiết hóa đơn: ${data.summary.receiptItemCount}.`,
        'File Excel gồm: tổng quan, giao dịch, hóa đơn, chi tiết hóa đơn, danh mục, thu chi theo kỳ, ví và phần giải thích.',
        methodology,
      ].join('\n'),
      {
        filename: report.filename,
        content: Buffer.from(report.base64, 'base64'),
        contentType: report.mimeType,
      },
      { html },
    );

    return {
      message:
        'Máy chủ email đã tiếp nhận báo cáo. Vui lòng kiểm tra hộp thư đến và thư rác.',
      filename: report.filename,
      mail,
    };
  }

  private async sendMail(
    to: string,
    subject: string,
    text: string,
    attachment: { filename: string; content: Buffer; contentType: string },
    options: { html?: string } = {},
  ) {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM?.trim() || user;

    if (!host || !from) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình dịch vụ email. Báo cáo chưa được gửi; bạn có thể tải file về máy.',
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      auth: user && pass ? { user, pass } : undefined,
    });

    let result: { accepted?: unknown[]; rejected?: unknown[] };
    try {
      result = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html: options.html,
        attachments: [attachment, ...buildEmailInlineAttachments()],
      });
    } catch {
      throw new ServiceUnavailableException(
        'Chưa xác nhận được máy chủ email đã nhận báo cáo. Hãy kiểm tra hộp thư trước khi gửi lại hoặc tải file về máy.',
      );
    }
    if (!result.accepted?.length || result.rejected?.length) {
      throw new ServiceUnavailableException(
        'Máy chủ email chưa chấp nhận địa chỉ nhận báo cáo. Vui lòng kiểm tra email hoặc tải file về máy.',
      );
    }

    return { delivered: false, accepted: true, devOnly: false };
  }

  private async buildAdditionalExcelData(
    userId: number,
    data: Awaited<ReturnType<ReportsService['buildReportData']>>,
  ) {
    const walletIds = data.wallets.map((wallet) => wallet.id);
    const transactionIds = data.rows.map((row) => row.id);
    const date = { gte: data.range.start, lt: data.range.end };
    const [transfers, savings, loans, payments] = await Promise.all([
      this.prisma.wallet_transfers.findMany({
        where: {
          user_id: userId,
          deleted_at: null,
          transfer_date: date,
          OR: [
            { source_wallet_id: { in: walletIds } },
            { destination_wallet_id: { in: walletIds } },
          ],
        },
        include: {
          source_wallet: true,
          destination_wallet: true,
          goal_entry: true,
        },
        orderBy: [{ transfer_date: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.savings_goal_entries.findMany({
        where: {
          deleted_at: null,
          entry_date: date,
          goal: { user_id: userId },
          OR: [
            { goal: { wallet_id: { in: walletIds } } },
            {
              transfer: {
                OR: [
                  { source_wallet_id: { in: walletIds } },
                  { destination_wallet_id: { in: walletIds } },
                ],
              },
            },
          ],
        },
        include: { goal: { include: { wallet: true } } },
        orderBy: [{ entry_date: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.loan_debts.findMany({
        where: {
          user_id: userId,
          deleted_at: null,
          OR: [
            { opening_transaction_id: { in: transactionIds } },
            {
              payments: {
                some: {
                  deleted_at: null,
                  transaction_id: { in: transactionIds },
                },
              },
            },
          ],
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.loan_debt_payments.findMany({
        where: {
          deleted_at: null,
          payment_date: date,
          transaction_id: { in: transactionIds },
          loan_debt: { user_id: userId, deleted_at: null },
        },
        include: { loan_debt: true },
        orderBy: [{ payment_date: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { transfers, savings, loans, payments };
  }

  private async exportExcel(
    data: Awaited<ReturnType<ReportsService['buildReportData']>>,
    extra?: Awaited<ReturnType<ReportsService['buildAdditionalExcelData']>>,
  ) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QuanLyChiTieu';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = `Báo cáo thu chi ${data.periodLabel}`;

    const moneyFormat = data.displayCurrency === 'VND' ? '#,##0' : '#,##0.00';
    const headerFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF57C00' },
    };
    const styleSheet = (sheet: ExcelJS.Worksheet, hasFilter = true) => {
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.properties.defaultRowHeight = 20;
      sheet.pageSetup = {
        orientation: sheet.columnCount > 7 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
        margins: {
          left: 0.3,
          right: 0.3,
          top: 0.5,
          bottom: 0.5,
          header: 0.2,
          footer: 0.2,
        },
      };
      const header = sheet.getRow(1);
      header.height = 28;
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = headerFill;
      header.alignment = { vertical: 'middle', wrapText: true };
      if (hasFilter && sheet.columnCount > 0) {
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
        };
      }
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.alignment = { vertical: 'top', wrapText: true };
          if (rowNumber % 2 === 0) {
            row.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFF8F1' },
            };
          }
        }
      });
    };

    const summarySheet = workbook.addWorksheet('Tổng quan');
    summarySheet.columns = [
      { header: 'Mục', key: 'label', width: 28 },
      { header: 'Giá trị', key: 'value', width: 32 },
    ];
    summarySheet.addRows([
      { label: 'Người dùng', value: data.user.full_name || data.user.email },
      { label: 'Email', value: data.user.email },
      { label: 'Kỳ báo cáo', value: data.periodLabel },
      { label: 'Từ ngày', value: formatDate(data.range.start) },
      {
        label: 'Đến ngày',
        value: formatDate(new Date(data.range.end.getTime() - 1)),
      },
      { label: 'Tiền tệ', value: data.displayCurrency },
      { label: 'Tổng thu thông thường', value: data.summary.income },
      { label: 'Tổng chi thông thường', value: data.summary.expense },
      { label: 'Chênh lệch thu – chi', value: data.summary.net },
      {
        label: 'Số giao dịch thu/chi/vay nợ',
        value: data.summary.transactionCount,
      },
      { label: 'Số hóa đơn', value: data.summary.receiptCount },
      {
        label: 'Số dòng chi tiết hóa đơn',
        value: data.summary.receiptItemCount,
      },
      { label: 'Thời điểm tạo', value: new Date() },
      { label: 'Số lần chuyển ví', value: extra?.transfers.length ?? 0 },
      { label: 'Số bút toán tiết kiệm', value: extra?.savings.length ?? 0 },
    ]);
    [8, 9, 10].forEach((row) => {
      summarySheet.getCell(row, 2).numFmt = moneyFormat;
    });
    summarySheet.getCell(14, 2).numFmt = 'dd/mm/yyyy hh:mm';

    const transactionSheet = workbook.addWorksheet('Giao dịch');
    transactionSheet.columns = [
      { header: 'Mã giao dịch', key: 'id', width: 15 },
      { header: 'Ngày', key: 'date', width: 14 },
      { header: 'Loại', key: 'type', width: 10 },
      { header: 'Ví', key: 'wallet', width: 22 },
      { header: 'Loại ví', key: 'walletType', width: 14 },
      { header: 'Danh mục', key: 'category', width: 22 },
      { header: 'Số tiền gốc', key: 'originalAmount', width: 18 },
      { header: 'Tiền tệ gốc', key: 'originalCurrency', width: 14 },
      { header: 'Tỷ giá đã lưu', key: 'exchangeRateUsed', width: 18 },
      { header: 'Số tiền quy đổi', key: 'amount', width: 20 },
      { header: 'Tiền tệ báo cáo', key: 'currency', width: 17 },
      { header: 'Hashtag', key: 'tags', width: 28 },
      { header: 'Ghi chú', key: 'note', width: 36 },
      { header: 'Trạng thái hóa đơn', key: 'receiptStatus', width: 31 },
      { header: 'Nhóm giao dịch', key: 'group', width: 24 },
      { header: 'Mã ví', key: 'walletId', width: 12 },
      { header: 'Mã danh mục', key: 'categoryId', width: 14 },
      { header: 'Ngày tạo', key: 'createdAt', width: 22 },
      { header: 'Ảnh hóa đơn', key: 'receiptImage', width: 45 },
      { header: 'Biến động gốc (+/−)', key: 'signedAmount', width: 22 },
    ];
    transactionSheet.addRows(
      data.rows.map((row) => ({
        id: row.id,
        date: row.date,
        type: row.type,
        wallet: safeSpreadsheetText(row.wallet),
        walletType: safeSpreadsheetText(row.walletType),
        category: safeSpreadsheetText(row.category),
        originalAmount: row.originalAmount,
        originalCurrency: row.originalCurrency,
        exchangeRateUsed: row.exchangeRateUsed,
        amount: row.amount,
        currency: row.currency,
        tags: safeSpreadsheetText(row.tags.map((tag) => `#${tag}`).join(' ')),
        note: safeSpreadsheetText(row.note),
        receiptStatus: row.receiptStatus,
        group:
          row.cashFlowGroup === 'loan_debt'
            ? 'Vay/nợ'
            : row.cashFlowGroup === 'saving_transfer'
              ? 'Tiết kiệm/chuyển ví'
              : 'Thu/chi thông thường',
        walletId: row.walletId,
        categoryId: row.categoryId,
        createdAt: row.createdAt,
        receiptImage: safeSpreadsheetText(row.receiptImage),
        signedAmount:
          row.type === 'Chi' ? -row.originalAmount : row.originalAmount,
      })),
    );
    transactionSheet.getColumn('date').numFmt = 'dd/mm/yyyy hh:mm:ss';
    transactionSheet.getColumn('createdAt').numFmt = 'dd/mm/yyyy hh:mm:ss';
    transactionSheet.getColumn('signedAmount').numFmt = '#,##0.00';
    transactionSheet.getColumn('originalAmount').numFmt = '#,##0.00';
    transactionSheet.getColumn('exchangeRateUsed').numFmt = '#,##0.########';
    transactionSheet.getColumn('amount').numFmt = moneyFormat;

    const receiptRows = data.rows.filter(
      (row) => row.hasReceiptImage || row.receiptItems.length,
    );
    const receiptSheet = workbook.addWorksheet('Hóa đơn');
    receiptSheet.columns = [
      { header: 'Mã giao dịch', key: 'id', width: 15 },
      { header: 'Ngày', key: 'date', width: 14 },
      { header: 'Ví', key: 'wallet', width: 22 },
      { header: 'Danh mục', key: 'category', width: 22 },
      { header: 'Ghi chú chung', key: 'note', width: 34 },
      { header: 'Tổng giao dịch', key: 'transactionTotal', width: 20 },
      { header: 'Tổng các món đã đọc', key: 'itemTotal', width: 22 },
      { header: 'Chênh lệch', key: 'difference', width: 18 },
      { header: 'Tiền tệ gốc', key: 'currency', width: 14 },
      { header: 'Số món đã đọc', key: 'itemCount', width: 17 },
      { header: 'Có ảnh', key: 'hasImage', width: 11 },
      { header: 'Kết quả kiểm tra', key: 'status', width: 31 },
    ];
    receiptSheet.addRows(
      receiptRows.map((row) => ({
        id: row.id,
        date: row.date,
        wallet: safeSpreadsheetText(row.wallet),
        category: safeSpreadsheetText(row.category),
        note: safeSpreadsheetText(row.note),
        transactionTotal: row.originalAmount,
        itemTotal: row.receiptItemTotal,
        difference: row.receiptDifference,
        currency: row.originalCurrency,
        itemCount: row.receiptItems.length,
        hasImage: row.hasReceiptImage ? 'Có' : 'Không',
        status: row.receiptStatus,
      })),
    );
    receiptSheet.getColumn('date').numFmt = 'dd/mm/yyyy';
    ['transactionTotal', 'itemTotal', 'difference'].forEach((key) => {
      receiptSheet.getColumn(key).numFmt = '#,##0.00';
    });

    const receiptDetailSheet = workbook.addWorksheet('Chi tiết hóa đơn');
    receiptDetailSheet.columns = [
      { header: 'Mã giao dịch', key: 'id', width: 15 },
      { header: 'Ngày', key: 'date', width: 14 },
      { header: 'STT', key: 'index', width: 9 },
      { header: 'Tên món/nội dung', key: 'name', width: 38 },
      { header: 'Thành tiền', key: 'amount', width: 20 },
      { header: 'Tiền tệ', key: 'currency', width: 12 },
      { header: 'Ghi chú', key: 'note', width: 32 },
    ];
    receiptDetailSheet.addRows(
      data.rows.flatMap((row) =>
        row.receiptItems.map((item, index) => ({
          id: row.id,
          date: row.date,
          index: index + 1,
          name: safeSpreadsheetText(item.name),
          amount: item.amount,
          currency: row.originalCurrency,
          note: safeSpreadsheetText(row.note),
        })),
      ),
    );
    receiptDetailSheet.getColumn('date').numFmt = 'dd/mm/yyyy';
    receiptDetailSheet.getColumn('amount').numFmt = '#,##0.00';

    const analysis = analyzeReportRows(
      data.rows.filter(
        (row) => !row.cashFlowGroup || row.cashFlowGroup === 'normal',
      ),
    );
    const categorySheet = workbook.addWorksheet('Danh mục');
    categorySheet.columns = [
      { header: 'Danh mục', key: 'category', width: 28 },
      { header: 'Tổng chi', key: 'amount', width: 20 },
      { header: 'Tỷ trọng (%)', key: 'percent', width: 16 },
      { header: 'Số giao dịch', key: 'count', width: 16 },
    ];
    categorySheet.addRows(
      analysis.categories.map((row) => ({
        ...row,
        category: safeSpreadsheetText(row.category),
      })),
    );
    categorySheet.getColumn('amount').numFmt = moneyFormat;
    categorySheet.getColumn('percent').numFmt = '0.0';
    const monthlySheet = workbook.addWorksheet('Thu chi theo kỳ');
    monthlySheet.columns = [
      { header: 'Tháng', key: 'month', width: 16 },
      { header: 'Tổng thu', key: 'income', width: 20 },
      { header: 'Tổng chi', key: 'expense', width: 20 },
      { header: 'Chênh lệch thu – chi', key: 'net', width: 24 },
      { header: 'Số giao dịch', key: 'count', width: 16 },
    ];
    monthlySheet.addRows(analysis.months);
    ['income', 'expense', 'net'].forEach((key) => {
      monthlySheet.getColumn(key).numFmt = moneyFormat;
    });

    const walletSheet = workbook.addWorksheet('Ví');
    walletSheet.columns = [
      { header: 'Tên ví', key: 'name', width: 24 },
      { header: 'Loại ví', key: 'type', width: 16 },
      { header: 'Tiền tệ', key: 'currency', width: 10 },
      { header: 'Số dư hiện tại', key: 'balance', width: 22 },
    ];
    walletSheet.addRows(
      data.wallets.map((wallet) => ({
        name: safeSpreadsheetText(wallet.name),
        type: safeSpreadsheetText(wallet.wallet_type),
        currency: wallet.currency,
        balance: Number(wallet.balance ?? 0),
      })),
    );
    walletSheet.getColumn('balance').numFmt = '#,##0.00';

    const addDetailSheet = (
      name: string,
      columns: Array<{
        header: string;
        key: string;
        width: number;
        format?: string;
      }>,
      rows: Array<Record<string, string | number | Date | null | undefined>>,
    ) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = columns;
      sheet.addRows(
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              typeof value === 'string' ? safeSpreadsheetText(value) : value,
            ]),
          ),
        ),
      );
      columns.forEach((column) => {
        if (column.format) sheet.getColumn(column.key).numFmt = column.format;
      });
    };
    const dateFormat = 'dd/mm/yyyy hh:mm:ss';
    const savingsType = (type: string) =>
      ({
        CONTRIBUTION: 'Gửi tiết kiệm',
        WITHDRAWAL: 'Rút tiết kiệm',
        ADJUSTMENT: 'Điều chỉnh tiết kiệm',
      })[type] ?? type;
    addDetailSheet(
      'Chuyển ví',
      [
        { header: 'Mã chuyển', key: 'id', width: 14 },
        { header: 'Ngày chuyển', key: 'date', width: 22, format: dateFormat },
        { header: 'Loại', key: 'type', width: 24 },
        { header: 'Mã ví nguồn', key: 'sourceId', width: 14 },
        { header: 'Ví nguồn', key: 'source', width: 24 },
        { header: 'Mã ví nhận', key: 'destinationId', width: 14 },
        { header: 'Ví nhận', key: 'destination', width: 24 },
        { header: 'Số tiền', key: 'amount', width: 20, format: '#,##0.00' },
        { header: 'Tiền tệ', key: 'currency', width: 12 },
        { header: 'Mã mục tiêu tiết kiệm', key: 'goalId', width: 22 },
        { header: 'Ghi chú', key: 'note', width: 40 },
        { header: 'Ngày tạo', key: 'createdAt', width: 22, format: dateFormat },
      ],
      (extra?.transfers ?? []).map((row) => ({
        id: row.id,
        date: row.transfer_date,
        type: row.goal_entry ? savingsType(row.goal_entry.type) : 'Chuyển ví',
        sourceId: row.source_wallet_id,
        source: row.source_wallet.name,
        destinationId: row.destination_wallet_id,
        destination: row.destination_wallet.name,
        amount: Number(row.amount),
        currency: row.currency,
        goalId: row.goal_entry?.goal_id,
        note: row.note,
        createdAt: row.created_at,
      })),
    );
    addDetailSheet(
      'Tiết kiệm',
      [
        { header: 'Mã bút toán', key: 'id', width: 15 },
        {
          header: 'Ngày giao dịch',
          key: 'date',
          width: 22,
          format: dateFormat,
        },
        { header: 'Loại', key: 'type', width: 25 },
        { header: 'Mã mục tiêu', key: 'goalId', width: 15 },
        { header: 'Mục tiêu', key: 'goal', width: 28 },
        { header: 'Ví tiết kiệm', key: 'wallet', width: 24 },
        { header: 'Số tiền', key: 'amount', width: 20, format: '#,##0.00' },
        { header: 'Tiền tệ', key: 'currency', width: 12 },
        { header: 'Mã chuyển ví liên kết', key: 'transferId', width: 22 },
        {
          header: 'Mục tiêu số tiền',
          key: 'target',
          width: 22,
          format: '#,##0.00',
        },
        {
          header: 'Hạn mục tiêu',
          key: 'targetDate',
          width: 22,
          format: dateFormat,
        },
        { header: 'Trạng thái mục tiêu hiện tại', key: 'status', width: 30 },
        { header: 'Ghi chú giao dịch', key: 'note', width: 40 },
        { header: 'Ghi chú mục tiêu', key: 'goalNote', width: 40 },
        { header: 'Ngày tạo', key: 'createdAt', width: 22, format: dateFormat },
      ],
      (extra?.savings ?? []).map((row) => ({
        id: row.id,
        date: row.entry_date,
        type: savingsType(row.type),
        goalId: row.goal_id,
        goal: row.goal.name,
        wallet: row.goal.wallet.name,
        amount: Number(row.amount),
        currency: row.goal.wallet.currency,
        transferId: row.transfer_id,
        target: Number(row.goal.target_amount),
        targetDate: row.goal.target_date,
        status: {
          ACTIVE: 'Đang thực hiện',
          COMPLETED: 'Hoàn thành',
          CANCELLED: 'Đã hủy',
        }[row.goal.status],
        note: row.note,
        goalNote: row.goal.note,
        createdAt: row.created_at,
      })),
    );
    addDetailSheet(
      'Vay nợ',
      [
        { header: 'Mã khoản vay/nợ', key: 'id', width: 18 },
        { header: 'Loại', key: 'type', width: 16 },
        { header: 'Người liên quan', key: 'person', width: 28 },
        { header: 'Tiền gốc', key: 'principal', width: 22, format: '#,##0.00' },
        { header: 'Tiền tệ', key: 'currency', width: 12 },
        {
          header: 'Ngày đến hạn',
          key: 'dueDate',
          width: 22,
          format: dateFormat,
        },
        { header: 'Trạng thái hiện tại', key: 'status', width: 24 },
        { header: 'Mã ví mở khoản', key: 'walletId', width: 18 },
        { header: 'Mã giao dịch gốc', key: 'transactionId', width: 20 },
        { header: 'Ghi chú', key: 'note', width: 40 },
        { header: 'Ngày tạo', key: 'createdAt', width: 22, format: dateFormat },
        {
          header: 'Cập nhật cuối',
          key: 'updatedAt',
          width: 22,
          format: dateFormat,
        },
      ],
      (extra?.loans ?? []).map((row) => ({
        id: row.id,
        type: row.type === 'BORROWED' ? 'Đi vay' : 'Cho vay',
        person: row.person_name,
        principal: Number(row.principal_amount),
        currency: row.currency,
        dueDate: row.due_date,
        status: row.status === 'PAID' ? 'Đã tất toán' : 'Chưa tất toán',
        walletId: row.opening_wallet_id,
        transactionId: row.opening_transaction_id,
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
    addDetailSheet(
      'Thanh toán vay nợ',
      [
        { header: 'Mã thanh toán', key: 'id', width: 17 },
        {
          header: 'Ngày thanh toán',
          key: 'date',
          width: 22,
          format: dateFormat,
        },
        { header: 'Loại', key: 'type', width: 18 },
        { header: 'Mã khoản vay/nợ', key: 'loanId', width: 18 },
        { header: 'Người liên quan', key: 'person', width: 28 },
        { header: 'Mã giao dịch', key: 'transactionId', width: 17 },
        { header: 'Mã ví', key: 'walletId', width: 12 },
        { header: 'Số tiền', key: 'amount', width: 22, format: '#,##0.00' },
        { header: 'Tiền tệ khoản vay', key: 'currency', width: 20 },
        { header: 'Ghi chú', key: 'note', width: 40 },
        { header: 'Ngày tạo', key: 'createdAt', width: 22, format: dateFormat },
      ],
      (extra?.payments ?? []).map((row) => ({
        id: row.id,
        date: row.payment_date,
        type: row.loan_debt.type === 'BORROWED' ? 'Trả nợ' : 'Thu hồi nợ',
        loanId: row.loan_debt_id,
        person: row.loan_debt.person_name,
        transactionId: row.transaction_id,
        walletId: row.wallet_id,
        amount: Number(row.amount),
        currency: row.loan_debt.currency,
        note: row.note,
        createdAt: row.created_at,
      })),
    );

    workbook.eachSheet((sheet) => styleSheet(sheet, sheet !== summarySheet));
    summarySheet.getColumn('value').width = 85;
    summarySheet.getColumn('value').alignment = {
      wrapText: true,
      vertical: 'top',
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const fileDate = formatFileDate(new Date());

    return {
      filename: `bao-cao-chi-tieu-${data.periodLabel}-${fileDate}.xlsx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Buffer.from(buffer).toString('base64'),
    };
  }

  private async exportPdf(
    data: Awaited<ReturnType<ReportsService['buildReportData']>>,
  ) {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    const chunks: Buffer[] = [];
    const regularFont = 'C:/Windows/Fonts/arial.ttf';
    const boldFont = 'C:/Windows/Fonts/arialbd.ttf';

    if (existsSync(regularFont)) {
      doc.registerFont('AppRegular', regularFont);
      doc.font('AppRegular');
    }

    if (existsSync(boldFont)) {
      doc.registerFont('AppBold', boldFont);
    }

    const useBold = () => {
      if (existsSync(boldFont)) {
        doc.font('AppBold');
      }
    };
    const useRegular = () => {
      if (existsSync(regularFont)) {
        doc.font('AppRegular');
      }
    };
    const money = (amount: number, currency: string = data.displayCurrency) =>
      `${amount.toLocaleString('vi-VN', {
        maximumFractionDigits: currency === 'VND' ? 0 : 2,
      })} ${currency}`;
    const pageBottom = () => doc.page.height - 55;
    const ensureSpace = (height: number, title?: string) => {
      if (doc.y + height <= pageBottom()) return;
      doc.addPage();
      if (title) {
        useBold();
        doc.fontSize(11).fillColor('#7A3E00').text(title);
        useRegular();
        doc.fillColor('#000000').moveDown(0.3);
      }
    };
    const sectionTitle = (title: string) => {
      ensureSpace(38);
      useBold();
      doc.fontSize(12).fillColor('#7A3E00').text(title);
      useRegular();
      doc.fillColor('#000000').moveDown(0.35);
    };

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    useBold();
    doc.fontSize(18).text('Báo cáo chi tiêu', { align: 'center' });
    useRegular();
    doc.moveDown(0.8);
    doc
      .fontSize(10)
      .text(`Người dùng: ${data.user.full_name || data.user.email}`);
    doc.text(`Email: ${data.user.email}`);
    doc.text(
      `Kỳ: ${data.periodLabel} | ${formatDate(data.range.start)} - ${formatDate(
        new Date(data.range.end.getTime() - 1),
      )}`,
    );
    doc.text(`Tiền tệ: ${data.displayCurrency}`);
    doc.moveDown();

    useBold();
    doc.fontSize(12).text('Tổng quan');
    useRegular();
    doc.fontSize(10).text(`Tổng thu: ${money(data.summary.income)}`);
    doc.text(`Tổng chi: ${money(data.summary.expense)}`);
    doc.text(`Chênh lệch thu – chi: ${money(data.summary.net)}`);
    doc.text(`Số giao dịch: ${data.summary.transactionCount}`);
    doc.text(
      `Hóa đơn: ${data.summary.receiptCount} | Dòng chi tiết: ${data.summary.receiptItemCount}`,
    );
    doc.moveDown();

    sectionTitle('Cách tính và phạm vi');
    doc.fontSize(9).text(REPORT_METHODOLOGY, { align: 'justify' });

    const analysis = analyzeReportRows(data.rows);
    sectionTitle('Danh mục chi nhiều nhất');
    if (!analysis.categories.length) {
      doc.fontSize(9).text('Không có khoản chi trong khoảng đã chọn.');
    } else {
      analysis.categories.slice(0, 8).forEach((row, index) => {
        ensureSpace(22, 'Danh mục chi nhiều nhất (tiếp)');
        doc
          .fontSize(9)
          .text(
            `${index + 1}. ${row.category}: ${money(row.amount)} (${row.percent.toFixed(1)}%) · ${row.count} giao dịch`,
          );
      });
    }

    sectionTitle('Hóa đơn trong kỳ');
    const receiptRows = data.rows.filter(
      (row) => row.hasReceiptImage || row.receiptItems.length,
    );
    if (!receiptRows.length) {
      doc.fontSize(9).text('Không có hóa đơn được lưu trong khoảng đã chọn.');
    } else {
      receiptRows.forEach((row) => {
        ensureSpace(42, 'Hóa đơn trong kỳ (tiếp)');
        doc
          .fontSize(9)
          .text(
            `#${row.id} · ${formatDate(row.date)} · ${row.category} · ${money(row.originalAmount, row.originalCurrency)}`,
          );
        doc
          .fontSize(8)
          .fillColor('#666666')
          .text(
            `${row.receiptStatus}; ${row.receiptItems.length} dòng chi tiết${row.receiptItems.length ? `; tổng đã đọc ${money(row.receiptItemTotal, row.originalCurrency)}` : ''}`,
          );
        doc.fillColor('#000000');
      });
    }

    sectionTitle('Chi tiết hóa đơn');
    const rowsWithReceiptItems = receiptRows.filter(
      (row) => row.receiptItems.length,
    );
    if (!rowsWithReceiptItems.length) {
      doc
        .fontSize(9)
        .text('Không có dòng chi tiết hóa đơn đã được lưu trong kỳ.');
    } else {
      rowsWithReceiptItems.forEach((row) => {
        ensureSpace(34, 'Chi tiết hóa đơn (tiếp)');
        useBold();
        doc
          .fontSize(9)
          .text(
            `Giao dịch #${row.id} · ${formatDate(row.date)} · ${row.category}`,
          );
        useRegular();
        row.receiptItems.forEach((item, index) => {
          const line = `${index + 1}. ${item.name} · ${money(item.amount, row.originalCurrency)}`;
          const lineHeight = doc.heightOfString(line, {
            width: doc.page.width - 100,
          });
          ensureSpace(lineHeight + 8, 'Chi tiết hóa đơn (tiếp)');
          doc
            .fontSize(8.5)
            .fillColor('#333333')
            .text(line, { indent: 12, width: doc.page.width - 100 });
        });
        if (Math.abs(row.receiptDifference) > 0.01) {
          ensureSpace(22, 'Chi tiết hóa đơn (tiếp)');
          doc
            .fontSize(8)
            .fillColor('#B45309')
            .text(
              `Cần kiểm tra: tổng chi tiết chênh ${money(row.receiptDifference, row.originalCurrency)} so với giao dịch.`,
              { indent: 12 },
            );
        }
        doc.fillColor('#000000').moveDown(0.25);
      });
    }

    sectionTitle('Giao dịch trong kỳ (theo ngày tăng dần)');

    data.rows.forEach((row) => {
      ensureSpace(48, 'Giao dịch trong kỳ (tiếp)');
      doc
        .fontSize(9)
        .text(
          `#${row.id} · ${formatDate(row.date)} · ${row.type} · ${row.category} · ${row.wallet} · ${money(row.amount, row.currency)}`,
        );
      if (row.note || row.tags.length) {
        doc
          .fontSize(8)
          .fillColor('#666666')
          .text(
            `${row.note}${row.tags.length ? ` | ${row.tags.map((tag) => `#${tag}`).join(' ')}` : ''}`,
          );
        doc.fillColor('#000000');
      }
    });

    if (!data.rows.length) {
      doc.fontSize(9).text('Không có giao dịch trong khoảng đã chọn.');
    }

    const pageRange = doc.bufferedPageRange();
    for (let index = 0; index < pageRange.count; index += 1) {
      doc.switchToPage(pageRange.start + index);
      useRegular();
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fontSize(8)
        .fillColor('#777777')
        .text(
          `QuanLyChiTieu · Trang ${index + 1}/${pageRange.count}`,
          40,
          doc.page.height - 32,
          { align: 'center', width: doc.page.width - 80, lineBreak: false },
        );
      doc.page.margins.bottom = bottomMargin;
    }
    doc.fillColor('#000000');

    doc.end();
    const buffer = await done;
    const fileDate = formatFileDate(new Date());

    return {
      filename: `bao-cao-chi-tieu-${data.periodLabel}-${fileDate}.pdf`,
      mimeType: 'application/pdf',
      base64: buffer.toString('base64'),
    };
  }
}
