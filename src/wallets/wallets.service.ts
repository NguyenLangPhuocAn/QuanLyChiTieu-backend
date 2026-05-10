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

type WalletRow = {
  id: number;
  user_id: number | null;
  name: string;
  currency: string;
  balance: Prisma.Decimal | null;
  budget_limit: Prisma.Decimal | null;
  created_at: Date | null;
};

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

    return new Prisma.Decimal(rawValue);
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

  private async findWalletById(id: number) {
    const rows = await this.prisma.$queryRaw<WalletRow[]>`
      SELECT id, user_id, name, currency, balance, budget_limit, created_at
      FROM wallets
      WHERE id = ${id}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  private async decorateWallet(
    wallet: WalletRow,
    targetCurrency?: string | null,
  ) {
    const displayCurrency = this.currencyService.normalizeCurrency(targetCurrency);
    const convertedBalance = await this.currencyService.convertAmount(
      wallet.balance,
      wallet.currency,
      displayCurrency,
    );
    const convertedBudget =
      wallet.budget_limit !== null
        ? await this.currencyService.convertAmount(
            wallet.budget_limit,
            wallet.currency,
            displayCurrency,
          )
        : null;

    return {
      ...wallet,
      currency: this.currencyService.normalizeCurrency(wallet.currency),
      display_currency: displayCurrency,
      display_balance: convertedBalance.amount,
      display_budget_limit: convertedBudget?.amount ?? null,
    };
  }

  async findAll(userId: number) {
    const actor = await this.getActor(userId);
    const wallets = await this.prisma.$queryRaw<WalletRow[]>`
      SELECT id, user_id, name, currency, balance, budget_limit, created_at
      FROM wallets
      WHERE user_id = ${userId}
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
      },
    });

    if (existed) {
      throw new BadRequestException('Tên ví đã tồn tại');
    }

    const currentWalletCount = await this.prisma.wallets.count({
      where: { user_id: userId },
    });

    if (actor.role === 'BASIC' && currentWalletCount >= 2) {
      throw new BadRequestException('Tài khoản BASIC chỉ được tạo tối đa 2 ví');
    }

    const balance = this.toDecimal(dto.balance, '0') ?? new Prisma.Decimal(0);
    const budgetLimit = this.toDecimal(dto.budget_limit) ?? null;
    const currency = this.currencyService.normalizeCurrency(
      dto.currency ?? actor.currency_default,
    );

    const walletId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO wallets (user_id, name, currency, balance, budget_limit, created_at)
        VALUES (${userId}, ${name}, ${currency}, ${balance}, ${budgetLimit}, NOW())
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

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền sửa ví này');
    }

    if (dto.balance !== undefined) {
      throw new BadRequestException(
        'Không thể sửa trực tiếp số dư ví. Hãy thêm giao dịch điều chỉnh.',
      );
    }

    const nextName = dto.name?.trim();
    const nextCurrency =
      dto.currency !== undefined
        ? this.currencyService.normalizeCurrency(dto.currency)
        : undefined;
    const hasUpdateData =
      nextName !== undefined ||
      dto.budget_limit !== undefined ||
      nextCurrency !== undefined;

    if (!hasUpdateData) {
      throw new BadRequestException('Không có dữ liệu để cập nhật');
    }

    if (nextName) {
      const existed = await this.prisma.wallets.findFirst({
        where: {
          user_id: wallet.user_id,
          name: nextName,
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

    await this.prisma.$executeRaw`
      UPDATE wallets
      SET
        name = COALESCE(${nextName ?? null}, name),
        currency = COALESCE(${nextCurrency ?? null}, currency),
        budget_limit = CASE
          WHEN ${dto.budget_limit !== undefined} THEN ${this.toDecimal(dto.budget_limit) ?? null}
          ELSE budget_limit
        END
      WHERE id = ${id}
    `;

    const actor = await this.getActor(userId);
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

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền xóa ví này');
    }

    await this.prisma.$executeRaw`
      DELETE FROM wallets
      WHERE id = ${id}
    `;

    return wallet;
  }
}
