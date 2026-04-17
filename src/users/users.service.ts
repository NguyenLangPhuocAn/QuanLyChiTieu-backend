import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // lấy danh sách user
  findAll() {
    return this.prisma.users.findMany();
  }
}