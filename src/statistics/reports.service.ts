import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import * as nodemailer from 'nodemailer';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StatisticsPeriod } from './statistics.service';

type ReportFormat = 'excel' | 'pdf';

type ReportTransaction = {
  id: number;
  wallet_id: number | null;
  category_id: number | null;
  amount: Prisma.Decimal;
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
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private getPeriodRange(period: StatisticsPeriod) {
    const now = new Date();

    if (period === 'day') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }

    if (period === 'week') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = start.getDay();
      start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }

    if (period === 'year') {
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear() + 1, 0, 1),
      };
    }

    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }

  private async buildReportData(userId: number, role: string | null, period: StatisticsPeriod) {
    if (role !== 'PREMIUM' && role !== 'ADMIN') {
      throw new ForbiddenException('Tính năng xuất báo cáo chỉ dành cho Premium');
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { email: true, full_name: true, currency_default: true },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const displayCurrency = this.currencyService.normalizeCurrency(user.currency_default);
    const range = this.getPeriodRange(period);
    const wallets = await this.prisma.wallets.findMany({
      where: { user_id: userId },
      select: { id: true, name: true, wallet_type: true, currency: true, balance: true },
      orderBy: { id: 'asc' },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
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
          select: { id: true, name: true, type: true },
        })
      : [];
    const categoryMap = new Map(categories.map((category) => [category.id, category]));
    const tagRows = transactions.length
      ? await this.prisma.$queryRaw<Array<{ transaction_id: number; name: string }>>`
          SELECT tt.transaction_id, t.name
          FROM transaction_tags tt
          INNER JOIN tags t ON t.id = tt.tag_id
          WHERE tt.transaction_id IN (${Prisma.join(transactions.map((item) => item.id))})
          ORDER BY t.name ASC
        `
      : [];
    const tagMap = new Map<number, string[]>();

    tagRows.forEach((row) => {
      tagMap.set(row.transaction_id, [...(tagMap.get(row.transaction_id) ?? []), row.name]);
    });

    let income = 0;
    let expense = 0;
    const rows: ReportRow[] = [];

    for (const transaction of transactions) {
      const wallet = transaction.wallet_id ? walletMap.get(transaction.wallet_id) : null;
      const category = transaction.category_id ? categoryMap.get(transaction.category_id) : null;
      const signedAmount = new Prisma.Decimal(transaction.amount);
      const converted = await this.currencyService.convertAmount(
        signedAmount.abs(),
        wallet?.currency ?? 'VND',
        displayCurrency,
      );
      const amount = converted.amount;

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
        transactionCount: transactions.length,
      },
      wallets,
      rows,
    };
  }

  async exportReport(userId: number, role: string | null, period: StatisticsPeriod, format: ReportFormat) {
    const data = await this.buildReportData(userId, role, period);

    if (format === 'excel') {
      return this.exportExcel(data);
    }

    return this.exportPdf(data);
  }

  async sendExcelReport(userId: number, role: string | null, period: StatisticsPeriod, email: string) {
    const recipient = email.trim().toLowerCase();

    if (!isEmail(recipient)) {
      throw new BadRequestException('Email nhận báo cáo chưa hợp lệ');
    }

    const data = await this.buildReportData(userId, role, period);
    const report = await this.exportExcel(data);
    const mail = await this.sendMail(
      recipient,
      `Báo cáo chi tiêu ${period}`,
      [
        `Xin chào ${data.user.full_name || data.user.email},`,
        '',
        'Báo cáo chi tiêu Excel của bạn đã được đính kèm trong email này.',
        `Kỳ báo cáo: ${formatDate(data.range.start)} - ${formatDate(new Date(data.range.end.getTime() - 1))}`,
        `Tổng thu: ${data.summary.income.toLocaleString('vi-VN')} ${data.displayCurrency}`,
        `Tổng chi: ${data.summary.expense.toLocaleString('vi-VN')} ${data.displayCurrency}`,
      ].join('\n'),
      {
        filename: report.filename,
        content: Buffer.from(report.base64, 'base64'),
        contentType: report.mimeType,
      },
    );

    return {
      message: mail.devOnly
        ? 'Đã tạo báo cáo. Chưa cấu hình email nên hệ thống ghi log ở chế độ dev.'
        : 'Đã gửi báo cáo Excel đến email của bạn.',
      filename: report.filename,
      mail,
    };
  }

  private async sendMail(
    to: string,
    subject: string,
    text: string,
    attachment: { filename: string; content: Buffer; contentType: string },
  ) {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM ?? user;

    if (!host || !from) {
      console.log(`[MAIL:DEV] To: ${to}\nSubject: ${subject}\n${text}`);
      return { delivered: false, devOnly: true };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      attachments: [attachment],
    });

    return { delivered: true, devOnly: false };
  }

  private async exportExcel(data: Awaited<ReturnType<ReportsService['buildReportData']>>) {
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
      { label: 'Kỳ báo cáo', value: data.period },
      { label: 'Từ ngày', value: formatDate(data.range.start) },
      { label: 'Đến ngày', value: formatDate(new Date(data.range.end.getTime() - 1)) },
      { label: 'Tiền tệ', value: data.displayCurrency },
      { label: 'Tổng thu', value: data.summary.income },
      { label: 'Tổng chi', value: data.summary.expense },
      { label: 'Số dư kỳ', value: data.summary.net },
      { label: 'Số giao dịch', value: data.summary.transactionCount },
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

    const walletSheet = workbook.addWorksheet('Vi');
    walletSheet.columns = [
      { header: 'Tên ví', key: 'name', width: 24 },
      { header: 'Loại ví', key: 'type', width: 16 },
      { header: 'Tiền tệ', key: 'currency', width: 10 },
      { header: 'Số dư', key: 'balance', width: 18 },
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

    const buffer = await workbook.xlsx.writeBuffer();
    const fileDate = formatFileDate(new Date());

    return {
      filename: `bao-cao-chi-tieu-${data.period}-${fileDate}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Buffer.from(buffer).toString('base64'),
    };
  }

  private async exportPdf(data: Awaited<ReturnType<ReportsService['buildReportData']>>) {
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
    doc.fontSize(10).text(`Người dùng: ${data.user.full_name || data.user.email}`);
    doc.text(`Email: ${data.user.email}`);
    doc.text(
      `Kỳ: ${data.period} | ${formatDate(data.range.start)} - ${formatDate(
        new Date(data.range.end.getTime() - 1),
      )}`,
    );
    doc.text(`Tiền tệ: ${data.displayCurrency}`);
    doc.moveDown();

    useBold();
    doc.fontSize(12).text('Tổng quan');
    useRegular();
    doc.fontSize(10).text(`Tổng thu: ${data.summary.income.toLocaleString('vi-VN')} ${data.displayCurrency}`);
    doc.text(`Tổng chi: ${data.summary.expense.toLocaleString('vi-VN')} ${data.displayCurrency}`);
    doc.text(`Số dư kỳ: ${data.summary.net.toLocaleString('vi-VN')} ${data.displayCurrency}`);
    doc.text(`Số giao dịch: ${data.summary.transactionCount}`);
    doc.moveDown();

    useBold();
    doc.fontSize(12).text('Giao dịch gần nhất');
    useRegular();
    doc.moveDown(0.3);

    data.rows.slice(0, 28).forEach((row) => {
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
          .text(`${row.note}${row.tags.length ? ` | ${row.tags.map((tag) => `#${tag}`).join(' ')}` : ''}`);
        doc.fillColor('#000000');
      }
    });

    doc.end();
    const buffer = await done;
    const fileDate = formatFileDate(new Date());

    return {
      filename: `bao-cao-chi-tieu-${data.period}-${fileDate}.pdf`,
      mimeType: 'application/pdf',
      base64: buffer.toString('base64'),
    };
  }
}
