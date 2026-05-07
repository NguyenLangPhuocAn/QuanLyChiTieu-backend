import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';

@Injectable()
export class WalletsService {
  constructor(private prisma: PrismaService) {}

  // Giữ cấu trúc trả về đồng nhất cho toàn bộ API ví.
  private readonly walletSelect = {
    id: true,
    user_id: true,
    name: true,
    balance: true,
    budget_limit: true,
    created_at: true,
  } as const;

  // Chuyển giá trị chuỗi hợp lệ sang Decimal của Prisma.
  private toDecimal(value?: string, fallback?: string) {
    const rawValue = value ?? fallback;

    if (rawValue === undefined) {
      return undefined;
    }

    return new Prisma.Decimal(rawValue);
  }

  // Lấy user hiện tại để biết role khi kiểm tra giới hạn tạo ví.
  private async getActor(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return user;
  }

  // Chỉ chủ ví mới được thao tác trên ví đó.
  private canAccessWallet(walletUserId: number | null, userId: number) {
    return walletUserId === userId;
  }

  async findAll(userId: number) {
    return this.prisma.wallets.findMany({
      where: { user_id: userId },
      orderBy: { id: 'desc' },
      select: this.walletSelect,
    });
  }

  async findOne(userId: number, id: number) {
    const wallet = await this.prisma.wallets.findUnique({
      where: { id },
      select: this.walletSelect,
    });

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền xem ví này');
    }

    return wallet;
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

    // BASIC chỉ được tạo tối đa 2 ví, còn PREMIUM và ADMIN thì không giới hạn.
    if (actor.role === 'BASIC' && currentWalletCount >= 2) {
      throw new BadRequestException('Tài khoản BASIC chỉ được tạo tối đa 2 ví');
    }

    return this.prisma.wallets.create({
      data: {
        user_id: userId,
        name,
        balance: this.toDecimal(dto.balance, '0'),
        budget_limit: this.toDecimal(dto.budget_limit),
      },
      select: this.walletSelect,
    });
  }

  async update(userId: number, id: number, dto: UpdateWalletDto) {
    const wallet = await this.prisma.wallets.findUnique({
      where: { id },
      select: this.walletSelect,
    });

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền sửa ví này');
    }

    // Không cho sửa số dư trực tiếp để tránh lệch với lịch sử giao dịch của ví.
    if (dto.balance !== undefined) {
      throw new BadRequestException(
        'Không thể sửa trực tiếp số dư ví. Hãy thêm giao dịch điều chỉnh.',
      );
    }

    const nextName = dto.name?.trim();
    const hasUpdateData =
      nextName !== undefined || dto.budget_limit !== undefined;

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

    return this.prisma.wallets.update({
      where: { id },
      data: {
        name: nextName ?? undefined,
        budget_limit:
          dto.budget_limit !== undefined
            ? this.toDecimal(dto.budget_limit)
            : undefined,
      },
      select: this.walletSelect,
    });
  }

  async remove(userId: number, id: number) {
    const wallet = await this.prisma.wallets.findUnique({
      where: { id },
      select: this.walletSelect,
    });

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    if (!this.canAccessWallet(wallet.user_id, userId)) {
      throw new BadRequestException('Bạn không có quyền xóa ví này');
    }

    return this.prisma.wallets.delete({
      where: { id },
      select: this.walletSelect,
    });
  }
}
