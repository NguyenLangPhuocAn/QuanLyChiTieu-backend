import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';

export type AuthenticatedUser = {
  userId: number;
  email: string;
  role: string | null;
};

export type RequestWithUser = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    const bearer =
      typeof authHeader === 'string'
        ? /^Bearer\s+(\S+)$/i.exec(authHeader)
        : null;
    if (!bearer) throw new UnauthorizedException('Vui lòng đăng nhập lại.');
    const secret = process.env.JWT_SECRET;
    if (!secret)
      throw new ServiceUnavailableException('Dịch vụ đăng nhập chưa sẵn sàng.');

    let decoded: jwt.JwtPayload | string;
    try {
      decoded = jwt.verify(bearer[1], secret, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.',
      );
    }
    const userId: unknown =
      typeof decoded === 'object' ? decoded.userId : undefined;
    if (
      typeof userId !== 'number' ||
      !Number.isSafeInteger(userId) ||
      userId <= 0
    ) {
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ.');
    }

    let rows: Array<{
      id: number;
      email: string;
      role: string | null;
      is_active: boolean | number | null;
      deleted_at: Date | null;
    }>;
    try {
      rows = await this.prisma.$queryRaw<typeof rows>`
        SELECT id, email, role, is_active, deleted_at
        FROM users
        WHERE id = ${userId} AND deleted_at IS NULL
        LIMIT 1
      `;
    } catch {
      throw new ServiceUnavailableException(
        'Chưa truy cập được dữ liệu tài khoản. Vui lòng thử lại sau.',
      );
    }
    const user = rows[0];
    if (
      !user ||
      user.is_active === false ||
      user.is_active === 0 ||
      user.deleted_at
    ) {
      throw new UnauthorizedException(
        'Tài khoản không còn hoạt động. Vui lòng đăng nhập lại.',
      );
    }
    request.user = { userId: user.id, email: user.email, role: user.role };
    return true;
  }
}
