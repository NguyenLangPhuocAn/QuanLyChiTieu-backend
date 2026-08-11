import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
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

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.split(' ')[1] ?? '';

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
        userId?: number;
      };

      if (!decoded.userId) {
        return false;
      }

      const rows = await this.prisma.$queryRaw<
        Array<{
          id: number;
          email: string;
          role: string | null;
          is_active: boolean | number | null;
        }>
      >`
        SELECT id, email, role, is_active
        FROM users
        WHERE id = ${decoded.userId}
        LIMIT 1
      `;
      const user = rows[0];

      if (!user || user.is_active === false || user.is_active === 0) {
        return false;
      }

      request.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
      };

      return true;
    } catch {
      return false;
    }
  }
}
