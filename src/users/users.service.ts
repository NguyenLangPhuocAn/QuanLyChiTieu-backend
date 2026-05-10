import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'crypto';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrencyService } from '../currency/currency.service';

type UserBase = {
  id: number;
  email: string;
  role: string | null;
  full_name?: string | null;
  phone?: string | null;
  birthday?: Date | null;
  address?: string | null;
  avatar?: string | null;
  currency_default?: string | null;
};

type AdminActor = {
  userId: number;
  email?: string;
  role?: string;
};

const SUPER_ADMIN_EMAIL = 'admin@gmail.com';
const ACCESS_TOKEN_EXPIRES_IN = '10m';
const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;

type UserWithWalletCount = UserBase & {
  wallet_count: number;
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  // Lấy số lượng ví của một user để hiển thị trong trang quản lý người dùng.
  private async getWalletCount(userId: number) {
    return this.prisma.wallets.count({
      where: { user_id: userId },
    });
  }

  // Gắn thêm trường wallet_count vào dữ liệu user trước khi trả về cho frontend.
  private async attachWalletCount<T extends UserBase>(user: T | null) {
    if (!user) {
      return null;
    }

    const wallet_count = await this.getWalletCount(user.id);

    return {
      ...user,
      wallet_count,
    } as T & { wallet_count: number };
  }

  // Gắn thêm wallet_count cho danh sách user.
  private async attachWalletCountList<T extends UserBase>(users: T[]) {
    return Promise.all(users.map((user) => this.attachWalletCount(user)));
  }

  private isSuperAdmin(user?: { email?: string | null }) {
    return user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
  }

  private assertAdminCanManageUser(
    actor: AdminActor | undefined,
    target: { id: number; email: string; role: string | null },
    dto: Record<string, any> = {},
    deleting = false,
  ) {
    if (!actor || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Không có quyền quản trị người dùng');
    }

    const actorIsSuperAdmin = this.isSuperAdmin(actor);
    const targetIsSuperAdmin = this.isSuperAdmin(target);
    const isSelf = actor.userId === target.id;
    const nextRole = dto.role;

    if (targetIsSuperAdmin && deleting) {
      throw new ForbiddenException('Không thể xóa tài khoản admin tổng');
    }

    if (deleting && isSelf) {
      throw new ForbiddenException('Admin không thể tự xóa chính mình');
    }

    if (deleting && !actorIsSuperAdmin) {
      throw new ForbiddenException('Admin thường không được xóa người dùng');
    }

    if (!actorIsSuperAdmin && !isSelf) {
      throw new ForbiddenException('Admin thường không được sửa người dùng khác');
    }

    if (targetIsSuperAdmin && !actorIsSuperAdmin) {
      throw new ForbiddenException('Chỉ admin tổng mới được cập nhật tài khoản admin tổng');
    }

    if (dto.email !== undefined && dto.email !== target.email) {
      throw new ForbiddenException('Email chỉ được xem, không được thay đổi');
    }

    if (!actorIsSuperAdmin && nextRole !== undefined && nextRole !== target.role) {
      throw new ForbiddenException('Admin thường không được thay đổi role người dùng');
    }

    if (isSelf && nextRole !== undefined && nextRole !== target.role) {
      throw new ForbiddenException('Admin không được tự đổi role của mình');
    }
  }

  private sanitizeAdminUpdate(dto: Record<string, any>) {
    const allowedKeys = [
      'email',
      'password',
      'full_name',
      'birthday',
      'phone',
      'address',
      'avatar',
      'role',
      'currency_default',
      'is_active',
    ];
    const sanitized: Record<string, any> = {};

    allowedKeys.forEach((key) => {
      if (dto[key] !== undefined) {
        sanitized[key] = dto[key];
      }
    });

    return sanitized;
  }

  private getRefreshTokenExpiry() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
    return expiresAt;
  }

  private signAccessToken(user: { id: number; role: string | null }) {
    return jwt.sign(
      {
        userId: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
    );
  }

  private async createRefreshToken(userId: number) {
    const jti = randomUUID();
    const secret = randomBytes(48).toString('base64url');
    const refreshToken = `${jti}.${secret}`;
    const tokenHash = await bcrypt.hash(refreshToken, 12);
    const expiresAt = this.getRefreshTokenExpiry();

    await this.prisma.$executeRaw`
      INSERT INTO refresh_tokens (user_id, jti, token_hash, expires_at)
      VALUES (${userId}, ${jti}, ${tokenHash}, ${expiresAt})
    `;

    return {
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  private getJtiFromRefreshToken(refreshToken?: string) {
    const [jti, secret] = (refreshToken ?? '').split('.');

    if (!jti || !secret) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    return jti;
  }

  private async issueTokenPair(user: { id: number; role: string | null }) {
    const accessToken = this.signAccessToken(user);
    const refresh = await this.createRefreshToken(user.id);

    return {
      accessToken,
      token: accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      ...refresh,
    };
  }

  private async revokeAllRefreshTokens(userId: number) {
    await this.prisma.$executeRaw`
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = ${userId}
        AND revoked_at IS NULL
    `;
  }

  // ================= GET ALL =================
  async findAll() {
    const users = await this.prisma.$queryRaw<
      Array<{
        id: number;
        email: string;
        role: string | null;
      }>
    >`
      SELECT id, email, role
      FROM users
      WHERE COALESCE(is_active, 1) = 1
    `;

    return this.attachWalletCountList(users);
  }

  // ================= GET ONE =================
  async findOne(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
        phone: true,
        birthday: true,
        address: true,
        avatar: true,
        currency_default: true,
      },
    });

    return this.attachWalletCount(user);
  }

  // ================= CREATE (REGISTER) =================
  async create(dto: CreateUserDto) {
    // Kiểm tra mật khẩu và xác nhận mật khẩu có khớp nhau không.
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    // Kiểm tra email đã tồn tại hay chưa.
    const existingUser = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email đã tồn tại');
    }

    // Mã hóa mật khẩu trước khi lưu xuống database.
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    return this.prisma.users.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        role: 'BASIC',
        currency_default: this.currencyService.normalizeCurrency(
          dto.currency_default,
        ),
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  // ================= UPDATE (ADMIN) =================
  async update(id: number, dto: any, actor?: AdminActor) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Nếu cập nhật mật khẩu thì phải băm lại trước khi lưu.
    dto = this.sanitizeAdminUpdate(dto);
    this.assertAdminCanManageUser(actor, user, dto);
    delete dto.email;

    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    // Chuyển ngày sinh từ chuỗi sang Date nếu có gửi lên.
    if (dto.birthday) {
      dto.birthday = new Date(dto.birthday);
    }

    if (dto.currency_default !== undefined) {
      dto.currency_default = this.currencyService.normalizeCurrency(
        dto.currency_default,
      );
    }

    const updatedUser = await this.prisma.users.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
      },
    });

    if (dto.password) {
      await this.revokeAllRefreshTokens(id);
    }

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(id),
    };
  }

  // ================= UPDATE AVATAR (ADMIN) =================
  async updateAvatar(id: number, avatar: string, actor?: AdminActor) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    this.assertAdminCanManageUser(actor, user);

    const updatedUser = await this.prisma.users.update({
      where: { id },
      data: { avatar },
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
        phone: true,
        birthday: true,
        address: true,
        avatar: true,
        currency_default: true,
      },
    });

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(id),
    };
  }

  // ================= DELETE =================
  async remove(id: number, actor?: AdminActor) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    this.assertAdminCanManageUser(actor, user, {}, true);

    await this.prisma.$executeRaw`
      UPDATE users
      SET is_active = 0
      WHERE id = ${id}
    `;
    const deactivatedUser = await this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
      },
    });

    if (!deactivatedUser) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    await this.revokeAllRefreshTokens(id);

    return deactivatedUser;
  }

  async deactivateSelf(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    if (this.isSuperAdmin(user)) {
      throw new ForbiddenException('Không thể vô hiệu hóa tài khoản admin tổng');
    }

    await this.prisma.$executeRaw`
      UPDATE users
      SET is_active = 0
      WHERE id = ${userId}
    `;
    const deactivatedUser = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
      },
    });

    if (!deactivatedUser) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    await this.revokeAllRefreshTokens(userId);

    return deactivatedUser;
  }

  // ================= LOGIN =================
  async login(email: string, password: string) {
    const user = await this.prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const statusRows = await this.prisma.$queryRaw<Array<{ is_active: boolean | number | null }>>`
      SELECT is_active
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `;

    if (statusRows[0]?.is_active === false || statusRows[0]?.is_active === 0) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const tokens = await this.issueTokenPair({ id: user.id, role: user.role });

    await this.prisma.admin_logs.create({
      data: {
        admin_id: user.id,
        action: 'Người dùng đăng nhập hệ thống',
      },
    });

    return {
      message: 'Đăng nhập thành công',
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    const jti = this.getJtiFromRefreshToken(refreshToken);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: number;
          user_id: number;
          token_hash: string;
          expires_at: Date;
          revoked_at: Date | null;
        }>
      >`
        SELECT id, user_id, token_hash, expires_at, revoked_at
        FROM refresh_tokens
        WHERE jti = ${jti}
        LIMIT 1
        FOR UPDATE
      `;
      const stored = rows[0];

      if (!stored || stored.revoked_at || stored.expires_at <= new Date()) {
        throw new UnauthorizedException('Refresh token hết hạn hoặc đã bị thu hồi');
      }

      const isMatch = await bcrypt.compare(refreshToken, stored.token_hash);

      if (!isMatch) {
        await tx.$executeRaw`
          UPDATE refresh_tokens
          SET revoked_at = NOW()
          WHERE user_id = ${stored.user_id}
            AND revoked_at IS NULL
        `;
        throw new UnauthorizedException('Refresh token không hợp lệ');
      }

      const users = await tx.$queryRaw<
        Array<{ id: number; role: string | null; is_active: boolean | number | null }>
      >`
        SELECT id, role, is_active
        FROM users
        WHERE id = ${stored.user_id}
        LIMIT 1
      `;
      const user = users[0];

      if (!user || user.is_active === false || user.is_active === 0) {
        throw new UnauthorizedException('Tài khoản đã bị khóa');
      }

      const newJti = randomUUID();
      const secret = randomBytes(48).toString('base64url');
      const nextRefreshToken = `${newJti}.${secret}`;
      const nextHash = await bcrypt.hash(nextRefreshToken, 12);
      const expiresAt = this.getRefreshTokenExpiry();
      const accessToken = this.signAccessToken({ id: user.id, role: user.role });

      await tx.$executeRaw`
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE id = ${stored.id}
          AND revoked_at IS NULL
      `;
      await tx.$executeRaw`
        INSERT INTO refresh_tokens (user_id, jti, token_hash, expires_at)
        VALUES (${user.id}, ${newJti}, ${nextHash}, ${expiresAt})
      `;

      return {
        message: 'Refresh token thành công',
        accessToken,
        token: accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: nextRefreshToken,
        refreshTokenExpiresAt: expiresAt,
      };
    });
  }

  async logout(userId: number, refreshToken?: string) {
    if (!refreshToken) {
      return { message: 'Logout' };
    }

    const jti = this.getJtiFromRefreshToken(refreshToken);

    await this.prisma.$executeRaw`
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = ${userId}
        AND jti = ${jti}
        AND revoked_at IS NULL
    `;

    return { message: 'Logout' };
  }

  // ================= CHANGE PASSWORD =================
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Kiểm tra mật khẩu cũ trước khi cho đổi mật khẩu mới.
    const isMatch = await bcrypt.compare(dto.oldPassword, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Mật khẩu cũ không đúng');
    }

    // Mật khẩu mới và xác nhận phải khớp nhau.
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE users
        SET password = ${hashedPassword}
        WHERE id = ${userId}
      `;
      await tx.$executeRaw`
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE user_id = ${userId}
          AND revoked_at IS NULL
      `;
    });

    return {
      message: 'Đổi mật khẩu thành công, vui lòng đăng nhập lại',
      forceLogout: true,
    };
  }

  // ================= UPDATE PROFILE =================
  async updateProfile(userId: number, dto: any) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    const allowedProfileKeys = [
      'full_name',
      'phone',
      'birthday',
      'address',
      'avatar',
      'currency_default',
    ];
    const sanitizedDto: Record<string, any> = {};

    allowedProfileKeys.forEach((key) => {
      if (dto[key] !== undefined) {
        sanitizedDto[key] = dto[key];
      }
    });

    // Chuyển birthday sang Date nếu người dùng có cập nhật.
    if (sanitizedDto.birthday) {
      sanitizedDto.birthday = new Date(sanitizedDto.birthday);
    }

    if (sanitizedDto.currency_default !== undefined) {
      sanitizedDto.currency_default = this.currencyService.normalizeCurrency(
        sanitizedDto.currency_default,
      );
    }

    const updatedUser = await this.prisma.users.update({
      where: { id: userId },
      data: sanitizedDto,
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
        phone: true,
        birthday: true,
        address: true,
        avatar: true,
        currency_default: true,
      },
    });

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(userId),
    };
  }
}
