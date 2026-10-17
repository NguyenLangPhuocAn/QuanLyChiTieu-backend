import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTransactionDto,
  TransactionType,
} from '../transactions/dto/create-transaction.dto';
import { TransactionsService } from '../transactions/transactions.service';
import {
  decryptPersonalBackup,
  encryptPersonalBackup,
} from './personal-backup.crypto';

const BACKUP_FORMAT = 'SO_THU_CHI_NOVA_PERSONAL_BACKUP';
const BACKUP_VERSION = 1;

type BackupTransaction = {
  row: number;
  wallet: { name: string; currency: string };
  category: {
    name: string;
    type: 'INCOME' | 'EXPENSE';
    cashFlowGroup: string;
  } | null;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  note: string | null;
  transactionDate: string;
  receiptItems: unknown[] | null;
  tags: string[];
};

type BackupPayload = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  dataTypes: string[];
  source: { app: 'Sổ Thu Chi Nova'; userIdHash: string };
  wallets: Array<{ name: string; currency: string; walletType: string }>;
  categories: Array<{ name: string; type: string; isSystem: boolean }>;
  transactions: BackupTransaction[];
};

type PreviewRow = BackupTransaction & {
  status: 'READY' | 'DUPLICATE' | 'INVALID';
  reason: string;
  walletId?: number;
  categoryId?: number;
};

@Injectable()
export class PersonalBackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  private fingerprint(input: {
    wallet: string;
    currency: string;
    amount: string;
    date: string;
    note?: string | null;
  }) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          wallet: input.wallet.trim().toLocaleLowerCase('vi'),
          currency: input.currency.trim().toUpperCase(),
          amount: new Prisma.Decimal(input.amount).toFixed(2),
          date: new Date(input.date).toISOString(),
          note: input.note?.trim().toLocaleLowerCase('vi') ?? '',
        }),
      )
      .digest('hex');
  }

  async export(userId: number, password: string) {
    const wallets = await this.prisma.wallets.findMany({
      where: { user_id: userId, deleted_at: null },
      select: {
        id: true,
        name: true,
        currency: true,
        wallet_type: true,
      },
      orderBy: { id: 'asc' },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const categories = await this.prisma.categories.findMany({
      where: {
        deleted_at: null,
        OR: [{ user_id: userId }, { user_id: null }],
      },
      select: {
        id: true,
        name: true,
        type: true,
        cash_flow_group: true,
        is_system: true,
      },
      orderBy: { id: 'asc' },
    });
    const transactions = walletIds.length
      ? await this.prisma.transactions.findMany({
          where: { wallet_id: { in: walletIds } },
          orderBy: [{ transaction_date: 'asc' }, { id: 'asc' }],
        })
      : [];
    const transactionIds = transactions.map((transaction) => transaction.id);
    const tagLinks = transactionIds.length
      ? await this.prisma.transaction_tags.findMany({
          where: { transaction_id: { in: transactionIds } },
        })
      : [];
    const tagIds = [...new Set(tagLinks.map((link) => link.tag_id))];
    const tags = tagIds.length
      ? await this.prisma.tags.findMany({
          where: { id: { in: tagIds }, user_id: userId },
          select: { id: true, name: true },
        })
      : [];
    const walletMap = new Map(wallets.map((wallet) => [wallet.id, wallet]));
    const categoryMap = new Map(
      categories.map((category) => [category.id, category]),
    );
    const tagMap = new Map(tags.map((tag) => [tag.id, tag.name]));
    const tagsByTransaction = new Map<number, string[]>();
    for (const link of tagLinks) {
      const name = tagMap.get(link.tag_id);
      if (!name) continue;
      const current = tagsByTransaction.get(link.transaction_id) ?? [];
      current.push(name);
      tagsByTransaction.set(link.transaction_id, current);
    }

    const payload: BackupPayload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      dataTypes: [
        'wallets',
        'categories',
        'transactions',
        'tags',
        'receiptItems',
      ],
      source: {
        app: 'Sổ Thu Chi Nova',
        userIdHash: createHash('sha256').update(String(userId)).digest('hex'),
      },
      wallets: wallets.map((wallet) => ({
        name: wallet.name,
        currency: wallet.currency,
        walletType: wallet.wallet_type,
      })),
      categories: categories.map((category) => ({
        name: category.name,
        type: category.type,
        isSystem: Boolean(category.is_system),
      })),
      transactions: transactions.flatMap((transaction, index) => {
        const wallet = transaction.wallet_id
          ? walletMap.get(transaction.wallet_id)
          : undefined;
        if (!wallet) return [];
        const category = transaction.category_id
          ? categoryMap.get(transaction.category_id)
          : undefined;
        const signedAmount = new Prisma.Decimal(transaction.amount);
        const type = signedAmount.isNegative() ? 'EXPENSE' : 'INCOME';
        return [
          {
            row: index + 1,
            wallet: { name: wallet.name, currency: wallet.currency },
            category: category
              ? {
                  name: category.name,
                  type: category.type,
                  cashFlowGroup: category.cash_flow_group,
                }
              : null,
            type,
            amount: signedAmount.abs().toFixed(2),
            note: transaction.note,
            transactionDate: transaction.transaction_date.toISOString(),
            receiptItems: Array.isArray(transaction.receipt_items)
              ? (transaction.receipt_items as unknown[])
              : null,
            tags: tagsByTransaction.get(transaction.id) ?? [],
          },
        ];
      }),
    };
    const encrypted = encryptPersonalBackup(payload, password);
    const date = payload.createdAt.slice(0, 10);
    return {
      filename: `so-thu-chi-nova-${date}.stcn-backup`,
      mimeType: 'application/vnd.sothuchinova.backup+json',
      base64: encrypted.toString('base64'),
      summary: {
        createdAt: payload.createdAt,
        dataTypes: payload.dataTypes,
        wallets: payload.wallets.length,
        transactions: payload.transactions.length,
      },
    };
  }

  private readPayload(file: Buffer, password: string) {
    if (file.length > 25 * 1024 * 1024) {
      throw new BadRequestException('File backup vượt quá 25 MB.');
    }
    const payload = decryptPersonalBackup<BackupPayload>(file, password);
    if (
      payload.format !== BACKUP_FORMAT ||
      payload.version !== BACKUP_VERSION ||
      !Array.isArray(payload.transactions) ||
      payload.transactions.length > 10_000
    ) {
      throw new BadRequestException(
        'Phiên bản hoặc nội dung backup không hợp lệ.',
      );
    }
    return payload;
  }

  private async buildPreview(userId: number, payload: BackupPayload) {
    const wallets = await this.prisma.wallets.findMany({
      where: { user_id: userId, deleted_at: null },
      select: { id: true, name: true, currency: true },
    });
    const categories = await this.prisma.categories.findMany({
      where: { deleted_at: null, OR: [{ user_id: userId }, { user_id: null }] },
      select: { id: true, name: true, type: true, cash_flow_group: true },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const existing = walletIds.length
      ? await this.prisma.transactions.findMany({
          where: { wallet_id: { in: walletIds } },
          select: {
            wallet_id: true,
            amount: true,
            transaction_date: true,
            note: true,
          },
        })
      : [];
    const walletsByKey = new Map(
      wallets.map((wallet) => [
        `${wallet.name.trim().toLocaleLowerCase('vi')}|${wallet.currency.toUpperCase()}`,
        wallet,
      ]),
    );
    const categoriesByKey = new Map(
      categories.map((category) => [
        `${category.name.trim().toLocaleLowerCase('vi')}|${category.type}`,
        category,
      ]),
    );
    const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
    const existingFingerprints = new Set(
      existing.flatMap((transaction) => {
        const wallet = transaction.wallet_id
          ? walletById.get(transaction.wallet_id)
          : undefined;
        return wallet
          ? [
              this.fingerprint({
                wallet: wallet.name,
                currency: wallet.currency,
                amount: transaction.amount.toString(),
                date: transaction.transaction_date.toISOString(),
                note: transaction.note,
              }),
            ]
          : [];
      }),
    );

    const rows: PreviewRow[] = payload.transactions.map((row, index) => {
      const normalized = { ...row, row: index + 1 };
      const wallet = walletsByKey.get(
        `${row.wallet?.name?.trim().toLocaleLowerCase('vi')}|${row.wallet?.currency?.toUpperCase()}`,
      );
      if (!wallet) {
        return {
          ...normalized,
          status: 'INVALID',
          reason: 'Không tìm thấy ví cùng tên và loại tiền trên thiết bị này.',
        };
      }
      const category = row.category
        ? categoriesByKey.get(
            `${row.category.name.trim().toLocaleLowerCase('vi')}|${row.category.type}`,
          )
        : undefined;
      if (row.category?.cashFlowGroup !== 'NORMAL') {
        return {
          ...normalized,
          status: 'INVALID',
          reason:
            'Giao dịch chuyển ví, tiết kiệm hoặc vay/nợ cần khôi phục bằng luồng chuyên biệt.',
          walletId: wallet.id,
        };
      }
      if (row.category && !category) {
        return {
          ...normalized,
          status: 'INVALID',
          reason: 'Không tìm thấy danh mục tương ứng.',
          walletId: wallet.id,
        };
      }
      try {
        const amount = new Prisma.Decimal(row.amount);
        if (!amount.isFinite() || amount.lessThanOrEqualTo(0))
          throw new Error();
        const fingerprint = this.fingerprint({
          wallet: wallet.name,
          currency: wallet.currency,
          amount:
            row.type === 'EXPENSE'
              ? amount.negated().toString()
              : amount.toString(),
          date: row.transactionDate,
          note: row.note,
        });
        if (existingFingerprints.has(fingerprint)) {
          return {
            ...normalized,
            status: 'DUPLICATE',
            reason: 'Đã có giao dịch cùng ví, tiền, thời gian và ghi chú.',
            walletId: wallet.id,
            categoryId: category?.id,
          };
        }
      } catch {
        return {
          ...normalized,
          status: 'INVALID',
          reason: 'Số tiền hoặc ngày giao dịch không hợp lệ.',
          walletId: wallet.id,
          categoryId: category?.id,
        };
      }
      return {
        ...normalized,
        status: 'READY',
        reason: 'Sẵn sàng khôi phục.',
        walletId: wallet.id,
        categoryId: category?.id,
      };
    });
    return rows;
  }

  async preview(userId: number, file: Buffer, password: string) {
    const payload = this.readPayload(file, password);
    const rows = await this.buildPreview(userId, payload);
    const count = (status: PreviewRow['status']) =>
      rows.filter((row) => row.status === status).length;
    return {
      metadata: {
        version: payload.version,
        createdAt: payload.createdAt,
        dataTypes: payload.dataTypes,
      },
      summary: {
        total: rows.length,
        ready: count('READY'),
        duplicate: count('DUPLICATE'),
        invalid: count('INVALID'),
      },
      rows,
    };
  }

  async restore(
    userId: number,
    file: Buffer,
    password: string,
    selectedRows: Set<number>,
  ) {
    const payload = this.readPayload(file, password);
    const previewRows = await this.buildPreview(userId, payload);
    const selected = previewRows.filter(
      (row) => selectedRows.has(row.row) && row.status === 'READY',
    );
    if (selected.length === 0) {
      throw new BadRequestException('Không có giao dịch hợp lệ nào được chọn.');
    }
    const backupHash = createHash('sha256').update(file).digest('hex');
    let restored = 0;
    const failed: Array<{ row: number; reason: string }> = [];
    for (const row of selected) {
      try {
        const dto: CreateTransactionDto = {
          wallet_id: row.walletId!,
          category_id: row.categoryId,
          amount: new Prisma.Decimal(row.amount).toFixed(2),
          type: TransactionType[row.type],
          note: row.note ?? undefined,
          receipt_items: row.receiptItems,
          transaction_date: row.transactionDate,
          tags: row.tags,
          client_request_id: `backup_${backupHash.slice(0, 40)}_${row.row}`,
        };
        await this.transactionsService.create(userId, dto);
        restored += 1;
      } catch (error) {
        failed.push({
          row: row.row,
          reason:
            error instanceof Error ? error.message : 'Không thể khôi phục.',
        });
      }
    }
    return {
      restored,
      failed: failed.length,
      skipped: selectedRows.size - selected.length,
      errors: failed.slice(0, 20),
    };
  }
}
