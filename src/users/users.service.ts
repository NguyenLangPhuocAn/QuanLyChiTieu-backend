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
import * as nodemailer from 'nodemailer';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrencyService } from '../currency/currency.service';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import {
  CompletePasswordSetupDto,
  ResetPasswordDto,
} from './dto/forgot-password.dto';

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
  must_change_password?: boolean | number | null;
  profile_setup_completed?: boolean | number | null;
};

type AdminActor = {
  userId: number;
  email?: string;
  role?: string;
};

type UserListQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  role?: string;
  sort?: string;
};

const SUPER_ADMIN_EMAIL = 'admin@gmail.com';
const ACCESS_TOKEN_EXPIRES_IN = '10m';
const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;
const RESET_TOKEN_TTL_MINUTES = 30;

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

    const actorIsSuperAdmin = this.isSuperAdmin(actor) ? 1 : 0;
    const targetIsSuperAdmin = this.isSuperAdmin(target);
    const isSelf = actor.userId === target.id;
    const nextRole = dto.role;

    if (isSelf) {
      throw new ForbiddenException('Admin hãy cập nhật hồ sơ của mình ở mục Hồ sơ admin');
    }

    if (targetIsSuperAdmin && deleting) {
      throw new ForbiddenException('Không thể xóa tài khoản admin tổng');
    }

    if (deleting && !actorIsSuperAdmin) {
      throw new ForbiddenException('Admin thường không được xóa người dùng');
    }

    if (!actorIsSuperAdmin && !isSelf && target.role === 'ADMIN') {
      throw new ForbiddenException('Admin thường không được sửa admin khác');
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
  }

  private assertAdminCanViewUser(
    actor: AdminActor | undefined,
    target: { id: number; email: string; role: string | null },
  ) {
    if (!actor || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Không có quyền quản trị người dùng');
    }

    if (actor.userId === target.id) {
      throw new ForbiddenException('Admin hãy xem hồ sơ của mình ở mục Hồ sơ admin');
    }

    if (!this.isSuperAdmin(actor) && target.role === 'ADMIN') {
      throw new ForbiddenException('Admin thường không được xem admin khác');
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
      'profile_setup_completed',
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
    const hashedToken = await bcrypt.hash(refreshToken, 12);
    const expiresAt = this.getRefreshTokenExpiry();

    await this.prisma.$executeRaw`
      INSERT INTO refresh_tokens (user_id, jti, token, expires_at)
      VALUES (${userId}, ${jti}, ${hashedToken}, ${expiresAt})
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

  private generateTemporaryPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const special = '@$!%*?&';
    const pick = (source: string) =>
      source[randomBytes(1)[0] % source.length];
    const chars = [
      pick('ABCDEFGHJKLMNPQRSTUVWXYZ'),
      pick('abcdefghijkmnopqrstuvwxyz'),
      pick('23456789'),
      pick(special),
      ...Array.from({ length: 8 }, () => pick(alphabet + special)),
    ];

    return chars.sort(() => randomBytes(1)[0] - 128).join('');
  }

  private async sendMail(to: string, subject: string, text: string) {
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

    await transporter.sendMail({ from, to, subject, text });
    return { delivered: true, devOnly: false };
  }

  private buildResetLink(token: string) {
    const baseUrl =
      process.env.PASSWORD_RESET_URL ??
      process.env.WEB_ADMIN_URL ??
      'http://localhost:3001/reset-password';
    const separator = baseUrl.includes('?') ? '&' : '?';

    return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
  }

  private createResetTokenParts() {
    const selector = randomBytes(12).toString('base64url');
    const secret = randomBytes(32).toString('base64url');

    return {
      selector,
      secret,
      publicToken: `${selector}.${secret}`,
    };
  }

  private parseResetToken(token: string) {
    const [selector, secret] = token.split('.');

    if (!selector || !secret) {
      throw new BadRequestException(
        'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
      );
    }

    return { selector, secret };
  }

  // ================= GET ALL =================
  async findAll(actor?: AdminActor, query: UserListQuery = {}) {
    if (!actor || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Không có quyền quản trị người dùng');
    }

    const actorIsSuperAdmin = this.isSuperAdmin(actor);
    const users = await this.prisma.$queryRaw<
      Array<{
        id: number;
        email: string;
        role: string | null;
        full_name: string | null;
        phone: string | null;
        birthday: Date | null;
        address: string | null;
        avatar: string | null;
        currency_default: string | null;
        must_change_password: boolean | number | null;
        profile_setup_completed: boolean | number | null;
      }>
    >`
      SELECT id, email, role, full_name, phone, birthday, address, avatar,
             currency_default, must_change_password, profile_setup_completed
      FROM users
      WHERE COALESCE(is_active, 1) = 1
        AND id <> ${actor.userId}
        AND (${actorIsSuperAdmin} = 1 OR role <> 'ADMIN')
    `;

    const keyword = query.keyword?.trim().toLowerCase();
    const role = query.role?.trim().toUpperCase();
    const filteredUsers = users.filter((user) => {
      const matchesKeyword = keyword
        ? [user.email, user.full_name, user.phone]
            .some((value) => value?.toLowerCase().includes(keyword))
        : true;
      const matchesRole = role && role !== 'ALL' ? user.role === role : true;

      return matchesKeyword && matchesRole;
    });
    const usersWithWalletCount = await this.attachWalletCountList(filteredUsers);
    const sortedUsers = usersWithWalletCount.sort((left, right) => {
      const sort = query.sort ?? 'name_asc';

      if (sort === 'name_asc' || sort === 'name_desc') {
        const leftName = left?.full_name || left?.email || '';
        const rightName = right?.full_name || right?.email || '';
        const result = leftName.localeCompare(rightName, 'vi');
        return sort === 'name_desc' ? -result : result;
      }

      if (sort === 'birth_asc' || sort === 'birth_desc') {
        const leftTime = left?.birthday ? new Date(left.birthday).getTime() : 0;
        const rightTime = right?.birthday ? new Date(right.birthday).getTime() : 0;
        const result = leftTime - rightTime;
        return sort === 'birth_desc' ? -result : result;
      }

      const result = (left?.wallet_count ?? 0) - (right?.wallet_count ?? 0);
      return sort === 'wallet_asc' ? result : -result;
    });

    if (!query.page && !query.limit) {
      return sortedUsers;
    }

    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 10), 1), 100);
    const total = sortedUsers.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const start = (page - 1) * limit;

    return {
      data: sortedUsers.slice(start, start + limit),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
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
        must_change_password: true,
        profile_setup_completed: true,
      },
    });

    return this.attachWalletCount(user);
  }

  async findOneForAdmin(id: number, actor?: AdminActor) {
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
        must_change_password: true,
        profile_setup_completed: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    this.assertAdminCanViewUser(actor, user);

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
        profile_setup_completed: false,
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  async createByAdmin(dto: AdminCreateUserDto, actor?: AdminActor) {
    if (!actor || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Không có quyền tạo người dùng');
    }

    const actorIsSuperAdmin = this.isSuperAdmin(actor);
    const role = dto.role ?? 'BASIC';

    if (role === 'ADMIN' && !actorIsSuperAdmin) {
      throw new ForbiddenException('Chỉ admin tổng được tạo tài khoản admin');
    }

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.users.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('Email đã tồn tại');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    const createdUser = await this.prisma.users.create({
      data: {
        email,
        password: hashedPassword,
        role: role as 'BASIC' | 'PREMIUM' | 'ADMIN',
        full_name: dto.full_name?.trim() || null,
        phone: dto.phone?.trim() || null,
        birthday: dto.birthday ? new Date(dto.birthday) : null,
        address: dto.address?.trim() || null,
        currency_default: this.currencyService.normalizeCurrency(
          dto.currency_default,
        ),
        must_change_password: true,
        profile_setup_completed: true,
      },
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
        must_change_password: true,
        profile_setup_completed: true,
      },
    });

    const mailResult = await this.sendMail(
      email,
      'Tài khoản Quản lý chi tiêu của bạn',
      [
        'Tài khoản của bạn đã được tạo.',
        `Email: ${email}`,
        `Mật khẩu tạm: ${temporaryPassword}`,
        'Vui lòng đăng nhập và đổi mật khẩu ở lần sử dụng đầu tiên.',
      ].join('\n'),
    );

    return {
      ...(await this.attachWalletCount(createdUser)),
      mail: mailResult,
    };
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
      dto.must_change_password = true;
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
        phone: true,
        birthday: true,
        address: true,
        avatar: true,
        currency_default: true,
        must_change_password: true,
        profile_setup_completed: true,
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
        must_change_password: true,
        profile_setup_completed: true,
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
      mustChangePassword: Boolean(user.must_change_password),
      ...tokens,
    };
  }

  async loginWithGoogle(profile: {
    email: string;
    providerId: string;
    fullName?: string | null;
    avatar?: string | null;
  }) {
    const email = profile.email.trim().toLowerCase();
    const user = await this.prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Email Google này chưa có tài khoản admin trong hệ thống',
      );
    }

    if (user.is_active === false) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    if (user.role !== 'ADMIN') {
      throw new UnauthorizedException('Chỉ tài khoản admin mới được vào web admin');
    }

    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        provider: 'google',
        provider_id: profile.providerId,
        full_name: user.full_name ?? profile.fullName ?? null,
        avatar: user.avatar ?? profile.avatar ?? null,
      },
    });

    const tokens = await this.issueTokenPair({ id: user.id, role: user.role });

    await this.prisma.admin_logs.create({
      data: {
        admin_id: user.id,
        action: 'Đăng nhập Google vào web admin',
      },
    });

    return {
      message: 'Đăng nhập Google thành công',
      mustChangePassword: Boolean(user.must_change_password),
      ...tokens,
    };
  }

  async loginMobileWithGoogle(profile: {
    email: string;
    providerId: string;
    fullName?: string | null;
    avatar?: string | null;
  }) {
    const email = profile.email.trim().toLowerCase();
    let user = await this.prisma.users.findUnique({
      where: { email },
    });

    if (user?.is_active === false) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    if (!user) {
      const randomPassword = randomBytes(32).toString('base64url');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await this.prisma.users.create({
        data: {
          email,
          password: hashedPassword,
          role: 'BASIC',
          provider: 'google',
          provider_id: profile.providerId,
          full_name: profile.fullName ?? null,
          avatar: profile.avatar ?? null,
          must_change_password: false,
          profile_setup_completed: false,
        },
      });
    } else {
      user = await this.prisma.users.update({
        where: { id: user.id },
        data: {
          provider: 'google',
          provider_id: profile.providerId,
          full_name: user.full_name ?? profile.fullName ?? null,
          avatar: user.avatar ?? profile.avatar ?? null,
          must_change_password: false,
        },
      });
    }

    const tokens = await this.issueTokenPair({ id: user.id, role: user.role });

    return {
      message: 'Đăng nhập Google thành công',
      mustChangePassword: Boolean(user.must_change_password),
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
          token: string;
          expires_at: Date;
          revoked_at: Date | null;
        }>
      >`
        SELECT id, user_id, token, expires_at, revoked_at
        FROM refresh_tokens
        WHERE jti = ${jti}
        LIMIT 1
        FOR UPDATE
      `;
      const stored = rows[0];

      if (!stored || stored.revoked_at || stored.expires_at <= new Date()) {
        throw new UnauthorizedException('Refresh token hết hạn hoặc đã bị thu hồi');
      }

      const isMatch = await bcrypt.compare(refreshToken, stored.token);

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
        Array<{
          id: number;
          role: string | null;
          is_active: boolean | number | null;
          must_change_password: boolean | number | null;
        }>
      >`
        SELECT id, role, is_active, must_change_password
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
      const hashedNextToken = await bcrypt.hash(nextRefreshToken, 12);
      const expiresAt = this.getRefreshTokenExpiry();
      const accessToken = this.signAccessToken({ id: user.id, role: user.role });

      await tx.$executeRaw`
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE id = ${stored.id}
          AND revoked_at IS NULL
      `;
      await tx.$executeRaw`
        INSERT INTO refresh_tokens (user_id, jti, token, expires_at)
        VALUES (${user.id}, ${newJti}, ${hashedNextToken}, ${expiresAt})
      `;

      return {
        message: 'Refresh token thành công',
        accessToken,
        token: accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: nextRefreshToken,
        refreshTokenExpiresAt: expiresAt,
        mustChangePassword: Boolean(user.must_change_password),
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

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.users.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, is_active: true },
    });

    const genericMessage =
      'Nếu email tồn tại, hệ thống đã gửi mật khẩu tạm thời.';

    if (!user || user.is_active === false) {
      return { message: genericMessage };
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    const mail = await this.sendMail(
      normalizedEmail,
      'Mật khẩu tạm thời Quản lý chi tiêu',
      [
        'Bạn vừa yêu cầu cấp lại mật khẩu.',
        `Mật khẩu tạm thời: ${temporaryPassword}`,
        'Vui lòng đăng nhập bằng mật khẩu tạm thời này và đổi sang mật khẩu mới ngay sau khi vào hệ thống.',
      ].join('\n'),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.password_resets.deleteMany({
        where: { email: normalizedEmail },
      });

      await tx.users.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          must_change_password: true,
        },
      });

      await tx.$executeRaw`
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE user_id = ${user.id}
          AND revoked_at IS NULL
      `;
    });

    return {
      message: genericMessage,
      mail,
    };
  }
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const { selector, secret } = this.parseResetToken(dto.token);
    const resetRequest = await this.prisma.password_resets.findUnique({
      where: { selector },
    });

    const isExpired =
      !resetRequest?.expired_at || resetRequest.expired_at <= new Date();
    const isAlreadyUsed = Boolean(resetRequest?.used_at);
    const isMatch = resetRequest?.token
      ? await bcrypt.compare(secret, resetRequest.token)
      : false;

    if (!resetRequest?.email || isExpired || isAlreadyUsed || !isMatch) {
      throw new BadRequestException(
        'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
      );
    }

    const user = await this.prisma.users.findUnique({
      where: { email: resetRequest.email },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          must_change_password: false,
        },
      });
      await tx.password_resets.update({
        where: { id: resetRequest.id },
        data: { used_at: new Date() },
      });
      await tx.$executeRaw`
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE user_id = ${user.id}
          AND revoked_at IS NULL
      `;
    });

    return { message: 'Đặt lại mật khẩu thành công' };
  }
  async completePasswordSetup(userId: number, dto: CompletePasswordSetupDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    if (!user.must_change_password) {
      throw new BadRequestException('Tài khoản này không cần tạo mật khẩu mới');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    const accessToken = this.signAccessToken({ id: user.id, role: user.role });
    const jti = randomUUID();
    const refreshSecret = randomBytes(48).toString('base64url');
    const refreshToken = `${jti}.${refreshSecret}`;
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 12);
    const refreshTokenExpiresAt = this.getRefreshTokenExpiry();

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE users
        SET password = ${hashedPassword},
            must_change_password = 0
        WHERE id = ${userId}
      `;
      await tx.$executeRaw`
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE user_id = ${userId}
          AND revoked_at IS NULL
      `;
      await tx.$executeRaw`
        INSERT INTO refresh_tokens (user_id, jti, token, expires_at)
        VALUES (${user.id}, ${jti}, ${hashedRefreshToken}, ${refreshTokenExpiresAt})
      `;
    });

    return {
      message: 'Tạo mật khẩu mới thành công',
      mustChangePassword: false,
      accessToken,
      token: accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshTokenExpiresAt,
    };
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
        SET password = ${hashedPassword},
            must_change_password = 0
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
      'profile_setup_completed',
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
        must_change_password: true,
        profile_setup_completed: true,
      },
    });

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(userId),
    };
  }

  async upgradeSelfToPremium(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    const updatedUser = await this.prisma.users.update({
      where: { id: userId },
      data: user.role === 'BASIC' ? { role: 'PREMIUM' } : {},
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
        must_change_password: true,
        profile_setup_completed: true,
      },
    });

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(userId),
    };
  }
}
