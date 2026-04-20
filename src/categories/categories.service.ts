import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-categories.dto';
import { UpdateCategoryDto } from './dto/update-categories.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  // ================= CREATE =================
  async create(userId: number, dto: CreateCategoryDto) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    // BASIC không được tạo
    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền tạo category');
    }

    return this.prisma.categories.create({
      data: {
        ...dto,
        user_id: userId,
        is_system: false,
      },
    });
  }
  // ================= GET ALL =================
  async findAll(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    // BASIC → chỉ system
    if (user?.role === 'BASIC') {
      return this.prisma.categories.findMany({
        where: { is_system: true },
        orderBy: { id: 'desc' },
      });
    }

    // PREMIUM → system + own
    if (user?.role === 'PREMIUM') {
      return this.prisma.categories.findMany({
        where: {
          OR: [
            { is_system: true },
            { user_id: userId },
          ],
        },
        orderBy: { id: 'desc' },
      });
    }

    // ADMIN → tất cả
    return this.prisma.categories.findMany({
      orderBy: { id: 'desc' },
    });
  }

  // ================= UPDATE =================
  async update(userId: number, id: number, dto: UpdateCategoryDto) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Category không tồn tại');
    }

    // ===== ADMIN: full quyền =====
    if (user?.role === 'ADMIN') {
      return this.prisma.categories.update({
        where: { id },
        data: dto,
      });
    }

    // ===== BASIC: cấm =====
    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    // ===== PREMIUM =====

    // không sửa system
    if (category.is_system) {
      throw new ForbiddenException('Không thể sửa category hệ thống');
    }

    // chỉ sửa của mình
    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    return this.prisma.categories.update({
      where: { id },
      data: dto,
    });
  }

  // ================= DELETE =================
  async remove(userId: number, id: number) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Category không tồn tại');
    }

    // ADMIN: full quyền
    if (user?.role === 'ADMIN') {
      return this.prisma.categories.delete({
        where: { id },
      });
    }

    // BASIC: cấm
    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    // PREMIUM

    if (category.is_system) {
      throw new ForbiddenException('Không thể xoá category hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    return this.prisma.categories.delete({
      where: { id },
    });
  }

  // ================= UPLOAD ICON =================
  async uploadIcon(userId: number, id: number, filename: string) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Category không tồn tại');
    }

    // ADMIN
    if (user?.role === 'ADMIN') {
      return this.prisma.categories.update({
        where: { id },
        data: { icon: filename },
      });
    }

    // BASIC
    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    // PREMIUM

    if (category.is_system) {
      throw new ForbiddenException('Không thể sửa category hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    return this.prisma.categories.update({
      where: { id },
      data: { icon: filename },
    });
  }
}