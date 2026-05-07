import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers['authorization'];

    // kiểm tra có header không
    if (!authHeader) return false;

    // kiểm tra format Bearer
    if (!authHeader.startsWith('Bearer ')) return false;

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string);

      // gắn user vào request
      request.user = decoded;

      return true;
    } catch (err) {
      return false;
    }
  }
}
