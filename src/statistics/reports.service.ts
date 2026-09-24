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
import { isNormalCashFlow } from '../common/finance/cash-flow-classification';
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
  transaction_date: Date;
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
  note: string;
  tags: string[];
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

@Injectable()
export class ReportsService {
  private readonly sendingUsers = new Set<number>();
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

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
            transaction_date: true,
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

      return isNormalCashFlow(category);
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

      if (signedAmount.greaterThanOrEqualTo(0)) {
        income += amount;
      } else {
        expense += amount;
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
        note: transaction.note ?? '',
        tags: tagMap.get(transaction.id) ?? [],
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
      },
      wallets,
      rows,
      periodLabel: periodLabels[period],
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
    );

    if (format === 'excel') {
      return this.exportExcel(data);
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
    );
    const report = await this.exportExcel(data);
    const rangeLabel = `${formatDate(data.range.start)} - ${formatDate(new Date(data.range.end.getTime() - 1))}`;
    const analysis = analyzeReportRows(data.rows);
    const money = (amount: number) =>
      `${amount.toLocaleString('vi-VN', { maximumFractionDigits: data.displayCurrency === 'VND' ? 0 : 2 })} ${data.displayCurrency}`;
    const topCategories = analysis.categories
      .slice(0, 5)
      .map(
        (row) =>
          `${row.category}: ${money(row.amount)} (${row.percent.toFixed(1)}%), ${row.count} giao dịch`,
      );
    const methodology =
      'Chỉ tính thu/chi thông thường; loại trừ chuyển nội bộ và vay/nợ. Chênh lệch thu – chi không phải số dư ví. Các khoản được quy đổi về tiền tệ báo cáo; ưu tiên giá trị quy đổi đã lưu, nếu chưa có dùng tỷ giá tại lúc tạo báo cáo.';
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
        'File Excel gồm: tổng quan, toàn bộ giao dịch, chi theo danh mục, thu chi theo tháng và số dư ví hiện tại.',
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

  private async exportExcel(
    data: Awaited<ReturnType<ReportsService['buildReportData']>>,
  ) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QuanLyChiTieu';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Tong quan');
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
      { label: 'Tổng thu', value: data.summary.income },
      { label: 'Tổng chi', value: data.summary.expense },
      { label: 'Chênh lệch thu – chi', value: data.summary.net },
      { label: 'Số giao dịch', value: data.summary.transactionCount },
      { label: 'Thời điểm tạo', value: new Date().toISOString() },
      {
        label: 'Phạm vi',
        value: 'Thu/chi thông thường; không gồm chuyển nội bộ và vay/nợ.',
      },
      {
        label: 'Quy đổi',
        value:
          'Ưu tiên số tiền quy đổi đã lưu; nếu chưa có dùng tỷ giá khi tạo báo cáo.',
      },
      {
        label: 'Lưu ý số dư',
        value:
          'Số dư trong sheet Ví là hiện tại, không phải số dư cuối kỳ báo cáo.',
      },
    ]);
    summarySheet.getRow(1).font = { bold: true };

    const transactionSheet = workbook.addWorksheet('Giao dich');
    transactionSheet.columns = [
      { header: 'Ngày', key: 'date', width: 14 },
      { header: 'Ví', key: 'wallet', width: 22 },
      { header: 'Loại ví', key: 'walletType', width: 14 },
      { header: 'Loại', key: 'type', width: 10 },
      { header: 'Danh mục', key: 'category', width: 22 },
      { header: 'Số tiền', key: 'amount', width: 18 },
      { header: 'Tiền tệ', key: 'currency', width: 10 },
      { header: 'Hashtag', key: 'tags', width: 28 },
      { header: 'Ghi chú', key: 'note', width: 36 },
    ];
    transactionSheet.addRows(
      data.rows.map((row) => ({
        date: formatDate(row.date),
        wallet: row.wallet,
        walletType: row.walletType,
        type: row.type,
        category: row.category,
        amount: row.amount,
        currency: row.currency,
        tags: row.tags.map((tag) => `#${tag}`).join(' '),
        note: row.note,
      })),
    );
    transactionSheet.getRow(1).font = { bold: true };
    transactionSheet.getColumn('amount').numFmt = '#,##0.00';
    const analysis = analyzeReportRows(data.rows);
    const categorySheet = workbook.addWorksheet('Chi theo danh muc');
    categorySheet.columns = [
      { header: 'Danh mục', key: 'category', width: 28 },
      { header: 'Tổng chi', key: 'amount', width: 20 },
      { header: 'Tỷ trọng (%)', key: 'percent', width: 16 },
      { header: 'Số giao dịch', key: 'count', width: 16 },
    ];
    categorySheet.addRows(analysis.categories);
    categorySheet.getColumn('amount').numFmt = '#,##0.00';
    categorySheet.getColumn('percent').numFmt = '0.0';
    const monthlySheet = workbook.addWorksheet('Thu chi theo thang');
    monthlySheet.columns = [
      { header: 'Tháng', key: 'month', width: 16 },
      { header: 'Tổng thu', key: 'income', width: 20 },
      { header: 'Tổng chi', key: 'expense', width: 20 },
      { header: 'Chênh lệch thu – chi', key: 'net', width: 24 },
      { header: 'Số giao dịch', key: 'count', width: 16 },
    ];
    monthlySheet.addRows(analysis.months);
    ['income', 'expense', 'net'].forEach((key) => {
      monthlySheet.getColumn(key).numFmt = '#,##0.00';
    });

    const walletSheet = workbook.addWorksheet('Vi');
    walletSheet.columns = [
      { header: 'Tên ví', key: 'name', width: 24 },
      { header: 'Loại ví', key: 'type', width: 16 },
      { header: 'Tiền tệ', key: 'currency', width: 10 },
      { header: 'Số dư hiện tại', key: 'balance', width: 22 },
    ];
    walletSheet.addRows(
      data.wallets.map((wallet) => ({
        name: wallet.name,
        type: wallet.wallet_type,
        currency: wallet.currency,
        balance: Number(wallet.balance ?? 0),
      })),
    );
    walletSheet.getRow(1).font = { bold: true };
    walletSheet.getColumn('balance').numFmt = '#,##0.00';
    workbook.eachSheet((sheet) => {
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).height = 26;
      if (sheet !== summarySheet)
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
        };
    });
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
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
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
    doc
      .fontSize(10)
      .text(
        `Tổng thu: ${data.summary.income.toLocaleString('vi-VN')} ${data.displayCurrency}`,
      );
    doc.text(
      `Tổng chi: ${data.summary.expense.toLocaleString('vi-VN')} ${data.displayCurrency}`,
    );
    doc.text(
      `Chênh lệch thu – chi: ${data.summary.net.toLocaleString('vi-VN')} ${data.displayCurrency}`,
    );
    doc.text(`Số giao dịch: ${data.summary.transactionCount}`);
    doc.moveDown();

    useBold();
    doc.fontSize(12).text('Giao dịch trong kỳ (đầy đủ, theo ngày tăng dần)');
    useRegular();
    doc.moveDown(0.3);

    data.rows.forEach((row) => {
      doc
        .fontSize(9)
        .text(
          `${formatDate(row.date)} | ${row.type} | ${row.category} | ${row.wallet} | ${row.amount.toLocaleString(
            'vi-VN',
          )} ${row.currency}`,
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
