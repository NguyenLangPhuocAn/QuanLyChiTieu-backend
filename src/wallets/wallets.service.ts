import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { WALLET_TYPES, type WalletType } from './dto/create-wallet.dto';

type WalletRow = {
  id: number;
  user_id: number | null;
  name: string;
  wallet_type: WalletType;
  currency: string;
  balance: Prisma.Decimal | null;
  is_active: boolean | number | null;
  deleted_at: Date | null;
  created_at: Date | null;
};

const BALANCE_ADJUSTMENT_NOTE = 'Điều chỉnh số dư';
const BALANCE_ADJUSTMENT_CATEGORY_NAME = 'Khác';
const BALANCE_ADJUSTMENT_CATEGORY_ICONS = {
  INCOME: 'categories/icons/expense_other.png',
  EXPENSE: 'categories/icons/expense_other.png',
} as const;

@Injectable()
export class WalletsService {
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  private toDecimal(value?: string, fallback?: string) {
    const rawValue = value ?? fallback;

    if (rawValue === undefined) {
      return undefined;
    }

    try {
      return new Prisma.Decimal(rawValue);
    } catch {
      throw new BadRequestException('Số tiền không hợp lệ');
    }
  }

  private async getActor(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        currency_default: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return user;
  }

  private canAccessWallet(walletUserId: number | null, userId: number) {
    return walletUserId === userId;
  }

  private normalizeWalletType(type?: string | null): WalletType {
    return WALLET_TYPES.includes(type as WalletType)
      ? (type as WalletType)
      : 'CASH';
  }

  private async findWalletById(id: number) {
    const rows = await this.prisma.$queryRaw<WalletRow[]>`
      SELECT id, user_id, name, wallet_type, currency, balance, is_active, deleted_at, created_at
      FROM wallets
      WHERE id = ${id}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  private async getBalanceAdjustmentCategoryId(
    tx: Prisma.TransactionClient,
    type: 'INCOME' | 'EXPENSE',
  ) {
    const icon = BALANCE_ADJUSTMENT_CATEGORY_ICONS[type];
    const existed = await tx.categories.findFirst({
      where: {
        type,
        is_system: true,
        OR: [{ name: BALANCE_ADJUSTMENT_CATEGORY_NAME }, { icon }],
      },
      select: { id: true },
    });

    if (existed) {
      return existed.id;
    }

    const created = await tx.categories.create({
      data: {
        name: BALANCE_ADJUSTMENT_CATEGORY_NAME,
        type,
        is_system: true,
        user_id: null,
        icon,
      },
      select: { id: true },
    });

    return created.id;
  }

  private async decorateWallet(
    wallet: WalletRow,
    targetCurrency?: string | null,
  ) {
    const displayCurrency =
      this.currencyService.normalizeCurrency(targetCurrency);
    const convertedBalance = await this.currencyService.convertAmount(
      wallet.balance,
      wallet.currency,
      displayCurrency,
    );
    return {
      ...wallet,
      currency: this.currencyService.normalizeCurrency(wallet.currency),
      display_currency: displayCurrency,
      display_balance: convertedBalance.amount,
    };
  }

  private async buildBalanceAdjustmentSnapshot(
    amount: Prisma.Decimal,
    sourceCurrency: string,
    targetCurrency?: string | null,
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

  async findAll(userId: number) {
    const actor = await this.getActor(userId);
    const wallets = await this.prisma.$queryRaw<WalletRow[]>`
      SELECT id, user_id, name, wallet_type, currency, balance, is_active, deleted_at, created_at
      FROM wallets
      WHERE user_id = ${userId}
        AND COALESCE(is_active, 1) = 1
      ORDER BY id DESC
    `;

    return Promise.all(
      wallets.map((wallet) =>
        this.decorateWallet(wallet, actor.currency_default),
      ),
    );
  }

  async findOne(userId: number, id: number) {
    const actor = await this.getActor(userId);
    const wallet = await this.findWalletById(id);

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (wallet.is_active === false || wallet.is_active === 0) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền xem ví này');
    }

    return this.decorateWallet(wallet, actor.currency_default);
  }

  async create(userId: number, dto: CreateWalletDto) {
    const actor = await this.getActor(userId);
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException('Tên ví không được để trống');
    }

    const existed = await this.prisma.wallets.findFirst({
      where: {
        user_id: userId,
        name,
        OR: [{ is_active: true }, { is_active: null }],
      },
    });

    if (existed) {
      throw new BadRequestException('Tên ví đã tồn tại');
    }

    const currentWalletCount = await this.prisma.wallets.count({
      where: {
        user_id: userId,
        OR: [{ is_active: true }, { is_active: null }],
      },
    });

    if (actor.role === 'BASIC' && currentWalletCount >= 2) {
      throw new BadRequestException('Tài khoản BASIC chỉ được tạo tối đa 2 ví');
    }

    const balance = this.toDecimal(dto.balance, '0') ?? new Prisma.Decimal(0);
    const currency = this.currencyService.normalizeCurrency(
      dto.currency ?? actor.currency_default,
    );
    const walletType = this.normalizeWalletType(dto.wallet_type);

    const walletId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO wallets (user_id, name, wallet_type, currency, balance, created_at)
        VALUES (${userId}, ${name}, ${walletType}, ${currency}, ${balance}, NOW())
      `;

      const rows = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT LAST_INSERT_ID() AS id
      `;

      return rows[0]?.id;
    });

    if (!walletId) {
      throw new BadRequestException('Không thể tạo ví');
    }

    const created = await this.findWalletById(walletId);

    if (!created) {
      throw new NotFoundException('Không tìm thấy ví vừa tạo');
    }

    return this.decorateWallet(created, actor.currency_default);
  }

  async update(userId: number, id: number, dto: UpdateWalletDto) {
    const wallet = await this.findWalletById(id);

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (wallet.is_active === false || wallet.is_active === 0) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền sửa ví này');
    }

    const nextName = dto.name?.trim();
    const nextCurrency =
      dto.currency !== undefined
        ? this.currencyService.normalizeCurrency(dto.currency)
        : undefined;
    const nextWalletType =
      dto.wallet_type !== undefined
        ? this.normalizeWalletType(dto.wallet_type)
        : undefined;
    const nextBalance = this.toDecimal(dto.balance);
    const hasUpdateData =
      nextName !== undefined ||
      nextWalletType !== undefined ||
      nextCurrency !== undefined ||
      nextBalance !== undefined;

    if (!hasUpdateData) {
      throw new BadRequestException('Không có dữ liệu để cập nhật');
    }

    if (nextName) {
      const existed = await this.prisma.wallets.findFirst({
        where: {
          user_id: wallet.user_id,
          name: nextName,
          OR: [{ is_active: true }, { is_active: null }],
          NOT: { id },
        },
      });

      if (existed) {
        throw new BadRequestException('Tên ví đã tồn tại');
      }
    }

    if (nextCurrency && nextCurrency !== wallet.currency) {
      const transactionCount = await this.prisma.transactions.count({
        where: { wallet_id: id },
      });

      if (transactionCount > 0) {
        throw new BadRequestException(
          'Không thể đổi tiền tệ cho ví đã có giao dịch',
        );
      }
    }

    const actor = await this.getActor(userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE wallets
        SET
          name = COALESCE(${nextName ?? null}, name),
          wallet_type = COALESCE(${nextWalletType ?? null}, wallet_type),
          currency = COALESCE(${nextCurrency ?? null}, currency)
        WHERE id = ${id}
      `;

      if (nextBalance !== undefined) {
        const currentBalance = new Prisma.Decimal(wallet.balance ?? 0);
        const adjustmentAmount = nextBalance.minus(currentBalance);

        if (!adjustmentAmount.isZero()) {
          const type = adjustmentAmount.greaterThan(0) ? 'INCOME' : 'EXPENSE';
          const categoryId = await this.getBalanceAdjustmentCategoryId(
            tx,
            type,
          );
          const conversionSnapshot = await this.buildBalanceAdjustmentSnapshot(
            adjustmentAmount,
            wallet.currency,
            actor.currency_default,
          );

          await tx.transactions.create({
            data: {
              wallet_id: id,
              category_id: categoryId,
              amount: adjustmentAmount,
              ...conversionSnapshot,
              note: BALANCE_ADJUSTMENT_NOTE,
              transaction_date: new Date(),
            },
          });

          await tx.wallets.update({
            where: { id },
            data: {
              balance: {
                increment: adjustmentAmount,
              },
            },
          });
        }
      }
    });

    const updated = await this.findWalletById(id);

    if (!updated) {
      throw new NotFoundException('Không tìm thấy ví sau cập nhật');
    }

    return this.decorateWallet(updated, actor.currency_default);
  }

  async remove(userId: number, id: number) {
    const wallet = await this.findWalletById(id);

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (wallet.is_active === false || wallet.is_active === 0) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền xóa ví này');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE wallets
        SET is_active = 0, deleted_at = NOW()
        WHERE id = ${id}
      `;
    });

    return {
      ...wallet,
      is_active: false,
      deleted_at: new Date(),
    };
  }
}
